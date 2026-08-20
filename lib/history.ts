import { randomUUID } from "node:crypto";
import { db, now } from "@/lib/database";

export type HistoryKind = "agent" | "job" | "flow" | "action" | "schedule";

export function startHistory(input: {
  kind: HistoryKind;
  title: string;
  status?: "ready" | "running" | "complete" | "error";
  event_type: string;
  content?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}) {
  const id = `${input.kind}-${randomUUID()}`;
  const timestamp = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO agent_sessions(id,title,history_kind,status,started_at,updated_at,error) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      input.title.slice(0, 200),
      input.kind,
      input.status || "complete",
      timestamp,
      timestamp,
      input.error || null,
    );
    db.prepare(
      "INSERT INTO agent_events(session_id,event_type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
    ).run(
      id,
      input.event_type.slice(0, 80),
      String(input.content || "").slice(0, 100_000),
      JSON.stringify(input.metadata || {}),
      timestamp,
    );
  })();
  return id;
}

export function appendHistory(
  id: string,
  input: {
    event_type: string;
    content?: string;
    metadata?: Record<string, unknown>;
    status?: "ready" | "running" | "complete" | "error";
    error?: string;
  },
) {
  const timestamp = now();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO agent_events(session_id,event_type,content,metadata_json,created_at) VALUES(?,?,?,?,?)",
    ).run(
      id,
      input.event_type.slice(0, 80),
      String(input.content || "").slice(0, 100_000),
      JSON.stringify(input.metadata || {}),
      timestamp,
    );
    db.prepare("UPDATE agent_sessions SET status=COALESCE(?,status),updated_at=?,error=? WHERE id=?").run(
      input.status || null,
      timestamp,
      input.error || null,
      id,
    );
  })();
}
