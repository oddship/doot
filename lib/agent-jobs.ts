import { randomUUID } from "node:crypto";
import { z } from "zod";
import { setAppState } from "@/lib/app-state";
import { enqueueBackgroundJob, getBackgroundJob, kickBackgroundJobs } from "@/lib/background-jobs";
import { db, json, now } from "@/lib/database";

const ref = z.object({
  account: z.string().min(1).max(200),
  uid: z.string().regex(/^\d+$/),
  folder: z.string().max(500).optional(),
});
const inputSchema = z.object({
  sessionId: z
    .string()
    .regex(/^[A-Za-z0-9-]{8,100}$/)
    .optional(),
  text: z.string().max(50000),
  organize: z.boolean().optional(),
  selected: z.array(ref).max(100).optional(),
  selectedRule: z.object({ id: z.number().int().positive() }).nullable().optional(),
  selectedDraft: z.object({ id: z.number().int().positive() }).nullable().optional(),
  selectedSearch: z
    .object({ account: z.string().max(200), query: z.string().max(500) })
    .nullable()
    .optional(),
});
const globals = globalThis as typeof globalThis & { __dootAgentObservers?: Map<string, Set<(event: any) => void>> };
globals.__dootAgentObservers ||= new Map();
export function enqueueAgentTurn(raw: unknown, commandId: string) {
  z.string().min(1).max(128).parse(commandId);
  const input = inputSchema.parse(raw);
  const job = db
    .transaction(() => {
      const old = db.prepare("SELECT id FROM background_jobs WHERE dedupe_key=?").get(`agent:${commandId}`) as any;
      if (old) return getBackgroundJob(old.id);
      const sessionId = input.sessionId || randomUUID();
      if (
        input.sessionId &&
        !db.prepare("SELECT 1 FROM agent_sessions WHERE id=? AND history_kind='agent'").get(sessionId)
      )
        throw new Error("Conversation not found");
      if (
        db
          .prepare(
            "SELECT 1 FROM background_jobs WHERE kind='agent' AND status IN ('queued','running') AND json_extract(payload_json,'$.sessionId')=?",
          )
          .get(sessionId)
      )
        throw new Error("This conversation already has a saved turn in progress");
      db.prepare(
        "INSERT OR IGNORE INTO agent_sessions(id,title,history_kind,status,started_at,updated_at) VALUES(?,?,'agent','ready',?,?)",
      ).run(sessionId, input.organize ? "Organize inboxes" : input.text.slice(0, 100), now(), now());
      setAppState("email-agent:conversation:v1", { sessionId });
      return enqueueBackgroundJob(
        "agent",
        `agent:${commandId}`,
        { sessionId },
        [{ ...input, sessionId, requestId: commandId }],
        `Agent · ${input.organize ? "Organize inboxes" : input.text.slice(0, 80)}`,
      );
    })
    .immediate();
  kickBackgroundJobs();
  return job;
}
export async function executeQueuedAgent(id: string, input: any) {
  const { runAgent } = await import("@/lib/agent-runtime");
  const sessionId = await runAgent(input, (event) => {
    for (const observer of globals.__dootAgentObservers!.get(id) || []) {
      try {
        observer(event);
      } catch {
        globals.__dootAgentObservers!.get(id)?.delete(observer);
      }
    }
  });
  const session = db.prepare("SELECT status,error FROM agent_sessions WHERE id=?").get(sessionId) as any;
  if (session?.status === "error") throw new Error(session.error || "Agent run failed");
  return { session_id: sessionId };
}
export async function observeAgentJob(id: string, send: (event: any) => void) {
  const set = globals.__dootAgentObservers!.get(id) || new Set();
  set.add(send);
  globals.__dootAgentObservers!.set(id, set);
  const row = db.prepare("SELECT payload_json FROM background_jobs WHERE id=?").get(id) as any;
  const sessionId = json<any>(row.payload_json, {}).sessionId;
  send({ type: "start", messageMetadata: { sessionId } });
  send({ type: "data-status", data: { status: "running", detail: "Task saved; Doot will continue in the app…" } });
  try {
    while (["queued", "running"].includes(getBackgroundJob(id).status))
      await new Promise((resolve) => setTimeout(resolve, 250));
    const job = getBackgroundJob(id);
    if (job.status !== "complete") throw new Error(job.error || job.status);
  } finally {
    set.delete(send);
    if (!set.size) globals.__dootAgentObservers!.delete(id);
  }
}
export function decideBodyApproval(sessionId: string, requestId: string, approved: boolean) {
  return db
    .transaction(() => {
      const key = `body-decision:${sessionId}:${requestId}`;
      const existing = db.prepare("SELECT value_json FROM app_state WHERE key=?").get(key) as any;
      if (existing) {
        const decision = json<any>(existing.value_json, {});
        if (decision.status !== (approved ? "approved" : "denied"))
          throw new Error("This request already has a saved decision");
        return decision;
      }
      const event = db
        .prepare(
          "SELECT metadata_json FROM agent_events WHERE session_id=? AND event_type='body_read_requested' AND json_extract(metadata_json,'$.request.id')=?",
        )
        .get(sessionId, requestId) as any;
      if (!event) throw new Error("Saved body request not found");
      const request = json<any>(event.metadata_json, {}).request;
      const status = approved ? "approved" : "denied";
      db.prepare(
        "INSERT INTO agent_events(session_id,event_type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
      ).run(sessionId, "body_read_decided", status, JSON.stringify({ request_id: requestId, status }), now());
      const job = approved
        ? enqueueAgentTurn(
            {
              sessionId,
              text: `I approved body access for the ${request.messages.length} exact messages in your saved request. Read these approved messages in bounded batches and continue my task.`,
              selected: request.messages,
              selectedSearch: request.scope
                ? { account: request.scope.account, query: request.scope.query }
                : undefined,
            },
            `body-approval:${requestId}`,
          )
        : undefined;
      const decision = { status, ...(job ? { job_id: job.id } : {}) };
      db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(key, JSON.stringify(decision));
      return decision;
    })
    .immediate();
}
