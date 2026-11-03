import { createHash, randomUUID } from "node:crypto";
import { db, json, now } from "@/lib/database";
import { startHistory } from "@/lib/history";
import { appendImapDraft, applyMailboxActions, mutateAccountFolder } from "@/lib/imap";
import { validateMailboxPath } from "@/lib/imap-folder";
import { normalizeMailActions, ruleActionFingerprint } from "@/lib/mail-actions";
import { createMailboxProposal } from "@/lib/proposals";
import { markRuleMatched, prepareRuleProposal, reconcileFolderRules } from "@/lib/rules";
import { getSyncJob } from "@/lib/sync";

const owner = process.env.DOOT_INSTANCE_ID || `process-${process.pid}`;
const globals = globalThis as typeof globalThis & { __dootBackgroundDrain?: Promise<void> };

function notify(resource = "jobs", items?: any[]) {
  try {
    (globalThis as any).__emailAgentBroadcast?.({ type: "cache.refresh", resource, ...(items ? { items } : {}) });
    if (resource === "jobs")
      (globalThis as any).__emailAgentBroadcast?.({ type: "cache.refresh", resource: "history" });
  } catch {
    /* A view notification must never interrupt saved execution. */
  }
}
export function getBackgroundJob(id: string) {
  const row = db.prepare("SELECT * FROM background_jobs WHERE id=?").get(id) as any;
  if (!row) throw new Error("job not found");
  const steps = db
    .prepare(
      "SELECT position,status,input_json,result_json,error FROM background_steps WHERE job_id=? ORDER BY position",
    )
    .all(id) as any[];
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    history_id: row.history_id,
    source: (() => {
      const payload = json<any>(row.payload_json, {});
      return {
        proposal_id: payload.proposal_id,
        draft_id: payload.draft_id,
        flow_id: payload.flow_id,
        schedule_id: payload.schedule?.id || payload.schedule_id,
        session_id: payload.sessionId,
      };
    })(),
    result: json(row.result_json, null),
    error: row.error,
    completed: steps.filter((step) => step.status === "complete").length,
    total: steps.length,
    steps: steps.map(({ result_json, input_json, ...step }) => {
      const input = json<any>(input_json, {});
      return {
        ...step,
        action: input.action || input.operation?.action || row.kind,
        account:
          input.item?.account ||
          input.account?.email ||
          (typeof input.account === "string" ? input.account : undefined),
        uid: input.item?.uid,
        folder: input.item?.source_folder || input.operation?.path,
        destination: input.action === "move" ? input.item?.folder : input.operation?.new_path,
        title: input.content?.subject,
        result: json(result_json, null),
      };
    }),
  };
}
export function listBackgroundJobs() {
  return {
    jobs: db
      .prepare(`SELECT b.id,b.kind,b.status,b.history_id,b.error,b.updated_at,
      COUNT(s.position) total,COALESCE(SUM(s.status='complete'),0) completed
      FROM background_jobs b LEFT JOIN background_steps s ON s.job_id=b.id
      WHERE b.status IN ('queued','running','needs_review') GROUP BY b.id
      ORDER BY CASE b.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,b.created_at DESC LIMIT 30`)
      .all(),
  };
}

export function enqueueBackgroundJob(kind: string, dedupeKey: string, payload: any, steps: any[], title: string) {
  return db
    .transaction(() => {
      const existing = db.prepare("SELECT id FROM background_jobs WHERE dedupe_key=?").get(dedupeKey) as any;
      if (existing) return getBackgroundJob(existing.id);
      const id = randomUUID();
      const historyId =
        kind === "agent"
          ? payload.sessionId
          : startHistory({
              kind: kind === "sync" ? "job" : kind === "schedule" ? "schedule" : "action",
              title,
              status: "running",
              event_type: "background_job_approved",
              content: "Approved work saved. Execution continues in the app without an open browser.",
              metadata: { job_id: id, kind, proposal_id: payload.proposal_id, draft_id: payload.draft_id },
            });
      if (kind === "agent") {
        db.prepare("UPDATE agent_sessions SET status='running',updated_at=? WHERE id=?").run(now(), historyId);
        db.prepare(
          "INSERT INTO agent_events(session_id,event_type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
        ).run(
          historyId,
          "background_job_approved",
          "Agent turn saved in the app",
          JSON.stringify({ job_id: id, kind }),
          now(),
        );
      }
      db.prepare(
        "INSERT INTO background_jobs(id,kind,dedupe_key,payload_json,created_at,updated_at,history_id) VALUES(?,?,?,?,?,?,?)",
      ).run(id, kind, dedupeKey, JSON.stringify(payload), now(), now(), historyId);
      const insert = db.prepare("INSERT INTO background_steps(job_id,position,input_json) VALUES(?,?,?)");
      steps.forEach((step, position) => {
        insert.run(id, position, JSON.stringify(step));
      });
      return getBackgroundJob(id);
    })
    .immediate();
}

export function approveProposal(id: number) {
  const job = db
    .transaction(() => {
      const existing = db
        .prepare("SELECT id FROM background_jobs WHERE kind='mailbox' AND json_extract(payload_json,'$.proposal_id')=?")
        .get(id) as any;
      if (existing) return getBackgroundJob(existing.id);
      const row = db.prepare("SELECT * FROM actions WHERE id=?").get(id) as any;
      if (row?.status !== "proposed") throw new Error("action is missing or not pending");
      const items = json<any[]>(row.items_json, []);
      if (!items.length || items.some((item) => !item.source_folder))
        throw new Error("Recreate proposal with exact source folders");
      const actions = normalizeMailActions(
        json(row.actions_json, []).length ? json(row.actions_json, []) : undefined,
        row.action,
      );
      const steps = items.flatMap((item) => {
        const checkpoint = db
          .prepare("SELECT uid_validity FROM sync_state WHERE account=? AND folder=?")
          .get(item.account, item.source_folder) as any;
        if (!checkpoint?.uid_validity) throw new Error("Sync the source mailbox before approving this proposal");
        if (!item.uid_validity)
          throw new Error("Recreate this proposal after syncing; its original mailbox identity was not saved");
        if (String(item.uid_validity) !== String(checkpoint.uid_validity))
          throw new Error("The mailbox changed since this proposal was prepared; recreate it");
        const exact = { ...item, uid_validity: String(item.uid_validity) };
        return actions.map((action) => ({ action, item: exact }));
      });
      const source = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(`proposal-source:${id}`) as any;
      const result = enqueueBackgroundJob(
        "mailbox",
        `proposal:${id}`,
        { proposal_id: id, ...json<any>(source?.value_json, {}) },
        steps,
        `Mailbox proposal ${id}`,
      );
      db.prepare("UPDATE actions SET status='queued' WHERE id=?").run(id);
      return result;
    })
    .immediate();
  kickBackgroundJobs();
  return job;
}

export function approveFlowRun(id: number, expected: string, commandId: string) {
  const job = db
    .transaction(() => {
      const existing = db
        .prepare("SELECT id FROM background_jobs WHERE dedupe_key=?")
        .get(`flow:${id}:${commandId}`) as any;
      if (existing) return getBackgroundJob(existing.id);
      const prepared = prepareRuleProposal(id);
      if (expected !== ruleActionFingerprint(prepared.rule))
        throw new Error("Flow changed since review; preview and confirm it again");
      const proposal = createMailboxProposal({
        action: prepared.rule.action,
        actions: prepared.rule.actions,
        items: prepared.items,
        reason: `Flow: ${prepared.rule.name}`,
        flowId: id,
      });
      const result = approveProposal(proposal.id);
      db.prepare("UPDATE background_jobs SET dedupe_key=? WHERE id=?").run(`flow:${id}:${commandId}`, result.id);
      markRuleMatched(id, prepared.matched);
      return result;
    })
    .immediate();
  kickBackgroundJobs();
  return job;
}

export function approveDraftUpload(draft: any) {
  if (!draft.content.to.length) throw new Error("add at least one To recipient before saving to IMAP");
  if (!draft.content.subject.trim() && !draft.content.body.trim()) throw new Error("the draft is empty");
  const hash = createHash("sha256").update(JSON.stringify(draft.content)).digest("hex");
  const job = enqueueBackgroundJob(
    "draft",
    `draft:${draft.id}:${hash}`,
    { draft_id: draft.id, content: draft.content },
    [{ content: draft.content }],
    `Save IMAP draft · ${draft.title}`,
  );
  kickBackgroundJobs();
  return job;
}
export function approveFolderMutation(account: string, operation: any, commandId: string) {
  if (typeof commandId !== "string" || !commandId || commandId.length > 128)
    throw new Error("A stable approval command ID is required");
  if (!["create", "rename", "delete"].includes(operation?.action)) throw new Error("Invalid folder operation");
  operation = {
    ...operation,
    path: validateMailboxPath(operation.path),
    ...(operation.action === "rename" ? { new_path: validateMailboxPath(operation.new_path) } : {}),
  };
  const hash = createHash("sha256").update(JSON.stringify({ account, operation })).digest("hex");
  const job = enqueueBackgroundJob(
    "folder",
    `folder:${commandId}:${hash}`,
    { account, operation },
    [{ account, operation }],
    `${operation.action} folder · ${operation.path}`,
  );
  kickBackgroundJobs();
  return job;
}

function finishJob(id: string, status: string, result: any, error?: string) {
  const kind = db
    .transaction(() => {
      const row = db.prepare("SELECT * FROM background_jobs WHERE id=?").get(id) as any;
      if (!row) return;
      db.prepare("UPDATE background_jobs SET status=?,result_json=?,error=?,updated_at=? WHERE id=?").run(
        status,
        JSON.stringify(result),
        error || null,
        now(),
        id,
      );
      const payload = json<any>(row.payload_json, {});
      if (row.kind === "mailbox")
        db.prepare("UPDATE actions SET status=?,applied_at=? WHERE id=?").run(
          status === "complete" ? "applied" : status,
          now(),
          payload.proposal_id,
        );
      if (row.kind === "draft" && status === "complete") {
        // An edit made while APPEND was running must remain an unsaved local draft.
        db.prepare("UPDATE agent_artifacts SET status='saved' WHERE id=? AND content_json=?").run(
          payload.draft_id,
          JSON.stringify(payload.content),
        );
      }
      db.prepare("UPDATE agent_sessions SET status=?,error=?,updated_at=? WHERE id=?").run(
        status === "complete" ? "complete" : "error",
        error || null,
        now(),
        row.history_id,
      );
      db.prepare(
        "INSERT INTO agent_events(session_id,event_type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
      ).run(
        row.history_id,
        "background_job_finished",
        status === "complete" ? "Approved work completed" : error || status,
        JSON.stringify({ job_id: id, status, result }),
        now(),
      );
      return row.kind;
    })
    .immediate();
  notify();
  if (kind === "sync") {
    notify("messages");
    try {
      (globalThis as any).__emailAgentBroadcast?.({ type: "sync.status", job: getSyncJob() });
    } catch {
      /* Views are optional. */
    }
  }
  if (kind === "draft") notify("drafts");
  if (kind === "folder") {
    notify("folders");
    notify("rules");
    notify("messages");
  }
}

export function cancelSavedAgentJobs(sessionId: string) {
  return db
    .transaction(() => {
      const jobs = db
        .prepare(
          "SELECT id FROM background_jobs WHERE kind='agent' AND history_id=? AND status IN ('queued','running')",
        )
        .all(sessionId) as any[];
      for (const job of jobs) {
        db.prepare(
          "UPDATE background_steps SET status='cancelled' WHERE job_id=? AND status IN ('queued','running')",
        ).run(job.id);
        finishJob(job.id, "cancelled", null, "Cancelled by user");
      }
      return jobs.length;
    })
    .immediate();
}

export function recoverBackgroundJobs() {
  // Only another app incarnation's claims are interrupted. An in-flight mailbox
  // command has an unknown outcome; it is never automatically invoked again.
  const rows = db
    .prepare("SELECT id,kind FROM background_jobs WHERE status='running' AND owner<>?")
    .all(owner) as any[];
  for (const { id, kind } of rows) {
    if (["sync", "schedule", "agent"].includes(kind)) {
      db.transaction(() => {
        db.prepare("UPDATE background_steps SET status='queued' WHERE job_id=? AND status='running'").run(id);
        db.prepare("UPDATE background_jobs SET status='queued',owner=NULL WHERE id=?").run(id);
      }).immediate();
      continue;
    }
    const uncertain = db.prepare("SELECT 1 FROM background_steps WHERE job_id=? AND status='running'").get(id);
    if (uncertain) {
      db.prepare("UPDATE background_steps SET status='needs_review',error=? WHERE job_id=? AND status='running'").run(
        "Application restarted without a confirmed receipt",
        id,
      );
      finishJob(
        id,
        "needs_review",
        { steps: getBackgroundJob(id).steps },
        "Application restarted during a mailbox write. Outcome may be unknown; review before retrying.",
      );
    } else db.prepare("UPDATE background_jobs SET status='queued',owner=NULL WHERE id=?").run(id);
  }
  kickBackgroundJobs();
}

async function executeJob(id: string) {
  const claimed = db
    .prepare("UPDATE background_jobs SET status='running',owner=?,updated_at=? WHERE id=? AND status='queued'")
    .run(owner, now(), id);
  if (!claimed.changes) return;
  const row = db.prepare("SELECT * FROM background_jobs WHERE id=?").get(id) as any;
  const steps = db.prepare("SELECT * FROM background_steps WHERE job_id=? ORDER BY position").all(id) as any[];
  for (const step of steps) {
    if (step.status === "complete") continue;
    const claim = db
      .prepare("UPDATE background_steps SET status='running' WHERE job_id=? AND position=? AND status='queued'")
      .run(id, step.position);
    if (!claim.changes) {
      finishJob(
        id,
        "needs_review",
        { steps: getBackgroundJob(id).steps },
        "A previous write has no receipt. Review before retrying.",
      );
      return;
    }
    notify();
    try {
      const input = json<any>(step.input_json, {});
      let result: any;
      if (row.kind === "agent") {
        const { executeQueuedAgent } = await import("@/lib/agent-jobs");
        result = await executeQueuedAgent(id, input);
      } else if (row.kind === "schedule") {
        const { executeScheduleOccurrence } = await import("@/lib/schedules");
        result = executeScheduleOccurrence(input.schedule);
      } else if (row.kind === "sync") {
        const { store } = await import("@/lib/store");
        try {
          result = await store([
            "sync",
            "--account",
            input.account.name,
            "--days",
            String(input.settings.sync_days),
            "--limit",
            String(input.settings.initial_sync_limit),
            "--scope",
            input.settings.sync_scope || "inbox",
            "--folders",
            JSON.stringify(input.settings.sync_folders?.[input.account.name] || []),
          ]);
        } catch (error: any) {
          result = { accounts: [], errors: [{ error: String(error?.message || error) }] };
        }
      } else if (row.kind === "mailbox") {
        result = await applyMailboxActions([input.action], [input.item]);
        notify("messages", result.results || []);
        if (result.status !== "applied") throw new Error(JSON.stringify(result));
      } else if (row.kind === "draft") result = await appendImapDraft(input.content.account, input.content);
      else if (row.kind === "folder") {
        const cached = db
          .prepare("SELECT delimiter FROM imap_folders WHERE account=? AND path=?")
          .get(input.account, input.operation.path) as any;
        result = await mutateAccountFolder(input.account, input.operation);
        reconcileFolderRules(input.account, input.operation, cached?.delimiter || result.folders[0]?.delimiter || "/");
      } else throw new Error("Unknown background job kind");
      if ((db.prepare("SELECT status FROM background_jobs WHERE id=?").get(id) as any)?.status === "cancelled") return;
      db.transaction(() => {
        db.prepare("UPDATE background_steps SET status='complete',result_json=? WHERE job_id=? AND position=?").run(
          JSON.stringify(result),
          id,
          step.position,
        );
        db.prepare("UPDATE background_jobs SET updated_at=? WHERE id=?").run(now(), id);
        db.prepare(
          "INSERT INTO agent_events(session_id,event_type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
        ).run(
          row.history_id,
          "background_step_complete",
          `Step ${step.position + 1} completed`,
          JSON.stringify({ job_id: id, position: step.position, result }),
          now(),
        );
      }).immediate();
      notify();
      if (row.kind === "sync") {
        notify("messages");
        try {
          (globalThis as any).__emailAgentBroadcast?.({ type: "sync.status", job: getSyncJob() });
        } catch {
          /* Views are optional. */
        }
      }
    } catch (error: any) {
      if ((db.prepare("SELECT status FROM background_jobs WHERE id=?").get(id) as any)?.status === "cancelled") return;
      db.prepare("UPDATE background_steps SET status=?,error=? WHERE job_id=? AND position=?").run(
        ["schedule", "agent"].includes(row.kind) ? "error" : "needs_review",
        String(error?.message || error),
        id,
        step.position,
      );
      finishJob(
        id,
        ["schedule", "agent"].includes(row.kind) ? "error" : "needs_review",
        { steps: getBackgroundJob(id).steps },
        ["schedule", "agent"].includes(row.kind)
          ? String(error?.message || error)
          : `Write was not confirmed. Some effects may have completed. ${String(error?.message || error)}`,
      );
      return;
    }
  }
  const completed = getBackgroundJob(id).steps;
  const failures = row.kind === "sync" ? completed.flatMap((step) => step.result?.errors || []) : [];
  finishJob(
    id,
    failures.length ? "error" : "complete",
    { steps: completed },
    failures.length ? failures.map((item) => item.error).join("; ") : undefined,
  );
}

export function kickBackgroundJobs() {
  if (globals.__dootBackgroundDrain) return globals.__dootBackgroundDrain;
  globals.__dootBackgroundDrain = Promise.resolve()
    .then(async () => {
      for (;;) {
        const next = db
          .prepare("SELECT id FROM background_jobs WHERE status='queued' ORDER BY created_at LIMIT 1")
          .get() as any;
        if (!next) break;
        await executeJob(next.id);
      }
    })
    .catch((error) => console.error("Background worker failed; saved claims retained:", error))
    .finally(() => {
      globals.__dootBackgroundDrain = undefined;
    });
  return globals.__dootBackgroundDrain;
}
