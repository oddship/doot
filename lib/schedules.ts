import { enqueueBackgroundJob, kickBackgroundJobs } from "@/lib/background-jobs";
import { db, json, now } from "@/lib/database";
import { startHistory } from "@/lib/history";
import { createMailboxProposal } from "@/lib/proposals";
import { getRule, markRuleMatched, prepareRuleProposal } from "@/lib/rules";
import { emitBackground } from "@/lib/store";
import { getSyncJob, startSync } from "@/lib/sync";

export type ScheduleFrequency = "once" | "daily" | "weekly";

function scheduleRow(row: any) {
  return row
    ? {
        ...row,
        id: Number(row.id),
        rule_id: row.rule_id == null ? null : Number(row.rule_id),
        enabled: Boolean(row.enabled),
      }
    : null;
}

export function listSchedules(input: { kind?: string; rule_id?: number } = {}) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (input.kind) {
    clauses.push("s.kind=?");
    values.push(input.kind);
  }
  if (input.rule_id) {
    clauses.push("s.rule_id=?");
    values.push(input.rule_id);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return {
    schedules: (
      db
        .prepare(
          `SELECT s.*,r.name rule_name FROM schedules s LEFT JOIN email_rules r ON r.id=s.rule_id${where} ORDER BY s.enabled DESC,s.next_run_at`,
        )
        .all(...values) as any[]
    ).map(scheduleRow),
  };
}

export function getSchedule(id: number) {
  const row = db
    .prepare("SELECT s.*,r.name rule_name FROM schedules s LEFT JOIN email_rules r ON r.id=s.rule_id WHERE s.id=?")
    .get(id);
  if (!row) throw new Error("schedule not found");
  return scheduleRow(row)!;
}

function validateRunAt(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) throw new Error("a valid first run time is required");
  if (date.getTime() < Date.now() - 60_000) throw new Error("the next run must be in the future");
  return date.toISOString();
}

export function saveSchedule(value: any, id?: number) {
  const existing = id ? getSchedule(id) : null;
  const kind = String(value.kind ?? existing?.kind ?? "");
  const frequency = String(value.frequency ?? existing?.frequency ?? "");
  const timezone = String(value.timezone ?? existing?.timezone ?? "UTC").slice(0, 100);
  const nextRunAt =
    value.next_run_at === undefined && existing ? existing.next_run_at : validateRunAt(value.next_run_at);
  const enabled = value.enabled === undefined ? Boolean(existing?.enabled ?? true) : Boolean(value.enabled);
  if (!(["flow", "sync"] as string[]).includes(kind)) throw new Error("invalid schedule kind");
  if (!(["once", "daily", "weekly"] as string[]).includes(frequency)) throw new Error("invalid schedule frequency");
  let ruleId: number | null = null;
  if (kind === "flow") {
    ruleId = Number(value.rule_id ?? existing?.rule_id);
    getRule(ruleId);
  }
  const timestamp = now();
  if (existing) {
    db.prepare(
      "UPDATE schedules SET kind=?,rule_id=?,frequency=?,timezone=?,next_run_at=?,enabled=?,updated_at=? WHERE id=?",
    ).run(kind, ruleId, frequency, timezone, nextRunAt, Number(enabled), timestamp, id);
    return getSchedule(id!);
  }
  const info = db
    .prepare(
      "INSERT INTO schedules(kind,rule_id,frequency,timezone,next_run_at,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(kind, ruleId, frequency, timezone, nextRunAt, Number(enabled), timestamp, timestamp);
  return getSchedule(Number(info.lastInsertRowid));
}

export function deleteSchedule(id: number) {
  const schedule = getSchedule(id);
  db.prepare("DELETE FROM schedules WHERE id=?").run(id);
  return schedule;
}

function nextOccurrence(frequency: ScheduleFrequency, scheduledFor: string) {
  if (frequency === "once") return null;
  const interval = frequency === "daily" ? 86_400_000 : 7 * 86_400_000;
  let next = new Date(scheduledFor).getTime() + interval;
  while (next <= Date.now()) next += interval;
  return new Date(next).toISOString();
}

export function runDueSchedules() {
  const results = db
    .transaction(() => {
      const due = db
        .prepare("SELECT * FROM schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 20")
        .all(new Date().toISOString()) as any[];
      return due.map((schedule) => {
        const job = enqueueBackgroundJob(
          "schedule",
          `schedule:${schedule.id}:${schedule.next_run_at}`,
          { schedule },
          [{ schedule }],
          `Scheduled ${schedule.kind}`,
        );
        const next = nextOccurrence(schedule.frequency, schedule.next_run_at);
        db.prepare("UPDATE schedules SET enabled=?,last_run_at=?,next_run_at=?,updated_at=? WHERE id=?").run(
          Number(Boolean(next)),
          now(),
          next || schedule.next_run_at,
          now(),
          schedule.id,
        );
        return { id: schedule.id, job_id: job.id };
      });
    })
    .immediate();
  kickBackgroundJobs();
  return { due: results.length, results };
}

export function executeScheduleOccurrence(schedule: any) {
  return db
    .transaction(() => {
      const key = `schedule-result:${schedule.id}:${schedule.next_run_at}`;
      const existing = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(key) as any;
      if (existing) return json(existing.value_json, {});
      let result: any;
      if (schedule.kind === "sync") {
        const active = getSyncJob();
        result =
          active.status === "running"
            ? { skipped: true, reason: "sync already running", sync_job_id: active.id }
            : {
                sync_job_id: startSync({
                  trigger: "schedule",
                  scheduleId: schedule.id,
                  commandId: `sync:schedule:${schedule.id}:${schedule.next_run_at}`,
                }).id,
              };
      } else {
        const rule = getRule(schedule.rule_id);
        if (!rule.enabled) result = { skipped: true, reason: "Flow paused" };
        else {
          try {
            const prepared = prepareRuleProposal(rule.id);
            const proposal = createMailboxProposal({
              action: rule.action,
              actions: rule.actions,
              items: prepared.items,
              reason: `Scheduled Flow: ${rule.name}`,
              flowId: rule.id,
            });
            markRuleMatched(rule.id, prepared.matched);
            startHistory({
              kind: "flow",
              title: `Scheduled Flow · ${rule.name}`,
              status: "ready",
              event_type: "scheduled_flow_proposal",
              content: `${prepared.items.length} of ${prepared.matched} matches prepared for review. No mailbox change was applied.`,
              metadata: { schedule_id: schedule.id, flow_id: rule.id, proposal_id: proposal.id },
            });
            result = { proposal_id: proposal.id, matched: prepared.matched, proposed: prepared.items.length };
          } catch (error: any) {
            if (!String(error?.message || error).includes("no current matches")) throw error;
            result = { matched: 0, proposed: 0 };
          }
        }
      }
      db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(key, JSON.stringify(result));
      emitBackground({ type: "cache.refresh", resource: "history" });
      return result;
    })
    .immediate();
}
