import { RouteError } from "@/lib/api/context";
import { getBackgroundJob } from "@/lib/background-jobs";
import { reviewProgress } from "@/lib/body-review";
import { db, json } from "@/lib/database";
import { store } from "@/lib/store";

export function apiPage(url: URL, maximum = 100) {
  const after = Number(url.searchParams.get("after") || 0);
  const limit = Number(url.searchParams.get("limit") || 20);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum)
    throw new RouteError(`Use a nonnegative after cursor and a limit from 1 to ${maximum}`, 400);
  return { after, limit };
}
export function requireSession(id: string) {
  const row = db.prepare("SELECT id,status,updated_at FROM agent_sessions WHERE id=?").get(id) as any;
  if (!row) throw new RouteError("Conversation not found", 404);
  return row;
}
export function eventPage(sessionId: string, url: URL) {
  const session = requireSession(sessionId);
  const { after, limit } = apiPage(url, 500);
  const rows = db
    .prepare(
      "SELECT id,event_type,role,content,metadata_json,created_at FROM agent_events WHERE session_id=? AND id>? ORDER BY id LIMIT ?",
    )
    .all(sessionId, after, limit + 1) as any[];
  const events = rows
    .slice(0, limit)
    .map(({ metadata_json, ...row }) => ({ ...row, metadata: json(metadata_json, {}) }));
  return {
    session_id: sessionId,
    session,
    events,
    next_after: events.at(-1)?.id ?? after,
    has_more: rows.length > limit,
  };
}
export function bodyApprovals(sessionId: string, url: URL) {
  requireSession(sessionId);
  const { after, limit } = apiPage(url);
  const rows = db
    .prepare(
      "SELECT id,metadata_json,created_at FROM agent_events WHERE session_id=? AND event_type='body_read_requested' AND id>? ORDER BY id LIMIT ?",
    )
    .all(sessionId, after, limit + 1) as any[];
  const get = db.prepare("SELECT value_json FROM app_state WHERE key=?");
  return {
    session_id: sessionId,
    approvals: rows.slice(0, limit).map((row) => {
      const request = json<any>(row.metadata_json, {}).request;
      const decision = get.get(`body-decision:${sessionId}:${request?.id}`) as any;
      return {
        event_id: row.id,
        request,
        decision: json(decision?.value_json, { status: "pending" }),
        created_at: row.created_at,
      };
    }),
    next_after: rows.slice(0, limit).at(-1)?.id ?? after,
    has_more: rows.length > limit,
  };
}
export function reviews(sessionId: string, url: URL) {
  requireSession(sessionId);
  const { after, limit } = apiPage(url);
  const prefix = `body-review:${sessionId}:`;
  const rows = db
    .prepare(
      "SELECT rowid,value_json FROM app_state WHERE substr(key,1,length(?))=? AND rowid>? ORDER BY rowid LIMIT ?",
    )
    .all(prefix, prefix, after, limit + 1) as any[];
  return {
    reviews: rows.slice(0, limit).map((row) => {
      const id = json<any>(row.value_json, {}).id;
      const { messages: _messages, next_offset: _next, ...summary } = reviewProgress(sessionId, id);
      return { ...summary, cursor: row.rowid };
    }),
    next_after: rows.slice(0, limit).at(-1)?.rowid ?? after,
    has_more: rows.length > limit,
  };
}
export function artifacts(url: URL) {
  const { after, limit } = apiPage(url);
  const rows = db
    .prepare(
      "SELECT id,kind,title,status,created_at FROM agent_artifacts WHERE id>? AND instr(lower(title),lower(?))>0 ORDER BY id LIMIT ?",
    )
    .all(after, url.searchParams.get("title") || "", limit + 1) as any[];
  return {
    artifacts: rows.slice(0, limit),
    next_after: rows.slice(0, limit).at(-1)?.id ?? after,
    has_more: rows.length > limit,
  };
}
export async function proposals(url: URL) {
  const { after, limit } = apiPage(url);
  const status = url.searchParams.get("status");
  const rows = db
    .prepare(`SELECT id FROM actions WHERE id>?${status ? " AND status=?" : ""} ORDER BY id LIMIT ?`)
    .all(...(status ? [after, status, limit + 1] : [after, limit + 1])) as any[];
  return {
    proposals: await Promise.all(rows.slice(0, limit).map((row) => store(["action-get", String(row.id)]))),
    next_after: rows.slice(0, limit).at(-1)?.id ?? after,
    has_more: rows.length > limit,
  };
}

export async function proposalVerification(id: number, url: URL) {
  const proposal = await store<any>(["action-get", String(id)]);
  const offset = Number(url.searchParams.get("offset") || 0);
  const { limit } = apiPage(url);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RouteError("Invalid offset", 400);
  // This read transaction makes the cache comparison consistent. It performs
  // no IMAP operation and intentionally makes no claim of live verification.
  return db.transaction(() => {
    const find = db.prepare("SELECT present,unread FROM messages WHERE account=? AND folder=? AND uid=?");
    const checkpoint = db.prepare(
      "SELECT last_sync,uid_validity,sync_days,sync_limit FROM sync_state WHERE account=? AND folder=?",
    );
    const counts = { present: 0, absent: 0, unknown: 0 };
    const messages = proposal.items.map((item: any) => {
      const cached = find.get(item.account, item.source_folder, String(item.uid)) as any;
      const sync = checkpoint.get(item.account, item.source_folder) as any;
      const sameMailbox = Boolean(
        sync?.uid_validity && item.uid_validity && String(sync.uid_validity) === String(item.uid_validity),
      );
      const state = !cached || !sameMailbox ? "unknown" : cached.present ? "present" : "absent";
      counts[state as keyof typeof counts]++;
      return {
        account: item.account,
        source_folder: item.source_folder,
        uid: String(item.uid),
        cache_state: state,
        cached_unread: cached ? Boolean(cached.unread) : null,
        sync: sync || null,
      };
    });
    const row = db
      .prepare(
        "SELECT id FROM background_jobs WHERE kind='mailbox' AND json_extract(payload_json,'$.proposal_id')=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(id) as any;
    const job = row ? getBackgroundJob(row.id) : null;
    return {
      proposal_id: id,
      proposal_status: proposal.status,
      total: messages.length,
      counts,
      messages: messages.slice(offset, offset + limit),
      next_offset: offset + limit < messages.length ? offset + limit : null,
      job,
      evidence: {
        level: "cache_and_execution_receipts",
        live_mailbox_checked: false,
        trash_verified: false,
        unread_state_verified: false,
        limitations: [
          "Cached presence may be stale or reflect a bounded sync window.",
          "A successful execution receipt does not independently verify the resulting mailbox state.",
          "Individual Trash placement is not verified by this endpoint. Never retry an uncertain write from these counts alone.",
        ],
      },
    };
  })();
}
