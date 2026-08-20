import { db, now } from "@/lib/database";
import { startHistory } from "@/lib/history";
import { getRule } from "@/lib/rules";
import { emitBackground, store } from "@/lib/store";
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

export async function runDueSchedules() {
  const due = db
    .prepare("SELECT id FROM schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 20")
    .all(new Date().toISOString()) as Array<{ id: number }>;
  const results: any[] = [];
  for (const item of due) {
    let schedule: ReturnType<typeof getSchedule>;
    try {
      schedule = getSchedule(item.id);
      const next = nextOccurrence(schedule.frequency as ScheduleFrequency, schedule.next_run_at);
      db.prepare("UPDATE schedules SET enabled=?,last_run_at=?,next_run_at=?,updated_at=? WHERE id=?").run(
        Number(Boolean(next)),
        now(),
        next || schedule.next_run_at,
        now(),
        schedule.id,
      );
      if (schedule.kind === "sync") {
        const activeSync = getSyncJob();
        if (activeSync.status === "running") {
          const historyId = startHistory({
            kind: "schedule",
            title: "Scheduled sync skipped · sync already running",
            status: "complete",
            event_type: "scheduled_sync_skipped",
            content: "A sync job was already active, so Doot did not start a duplicate job.",
            metadata: { schedule_id: schedule.id, active_sync_job_id: activeSync.id },
          });
          results.push({
            id: schedule.id,
            kind: schedule.kind,
            skipped: true,
            active_sync_job_id: activeSync.id,
            history_id: historyId,
          });
        } else {
          const sync = await startSync({ trigger: "schedule", scheduleId: schedule.id });
          results.push({ id: schedule.id, kind: schedule.kind, sync_job_id: sync.id });
        }
      } else {
        const rule = getRule(schedule.rule_id!);
        if (!rule.enabled) {
          const historyId = startHistory({
            kind: "flow",
            title: `Scheduled Flow skipped · ${rule.name}`,
            status: "complete",
            event_type: "scheduled_flow_skipped",
            content: "The Flow is paused, so no proposal was prepared.",
            metadata: { schedule_id: schedule.id, flow_id: rule.id },
          });
          results.push({ id: schedule.id, kind: schedule.kind, skipped: true, history_id: historyId });
        } else {
          let prepared: any;
          try {
            prepared = await store<any>(["rule-propose", String(rule.id)]);
          } catch (error: any) {
            if (!String(error?.message || error).includes("no current matches")) throw error;
            const historyId = startHistory({
              kind: "flow",
              title: `Scheduled Flow · ${rule.name}`,
              status: "complete",
              event_type: "scheduled_flow_no_matches",
              content: "The Flow had no current matches, so there was nothing to review or apply.",
              metadata: { schedule_id: schedule.id, flow_id: rule.id, matched: 0, proposed: 0 },
            });
            results.push({ id: schedule.id, kind: schedule.kind, matched: 0, history_id: historyId });
            continue;
          }
          const historyId = startHistory({
            kind: "flow",
            title: `Scheduled Flow · ${rule.name}`,
            status: "ready",
            event_type: "scheduled_flow_proposal",
            content: `${prepared.proposed} of ${prepared.matched} current matches prepared for review. No mailbox change was applied.`,
            metadata: {
              schedule_id: schedule.id,
              flow_id: rule.id,
              proposal_id: prepared.proposal.id,
              matched: prepared.matched,
              proposed: prepared.proposed,
            },
          });
          emitBackground({ type: "proposal.created", proposal: prepared.proposal });
          results.push({
            id: schedule.id,
            kind: schedule.kind,
            proposal_id: prepared.proposal.id,
            history_id: historyId,
          });
        }
      }
    } catch (error: any) {
      const message = String(error?.message || error);
      const historyId = startHistory({
        kind: "schedule",
        title: `Scheduled ${schedule?.kind || "job"} failed`,
        status: "error",
        event_type: "schedule_failed",
        content: message,
        metadata: { schedule_id: item.id },
        error: message,
      });
      results.push({ id: item.id, error: message, history_id: historyId });
    }
  }
  if (due.length) emitBackground({ type: "cache.refresh", resource: "history" });
  return { due: due.length, results };
}
