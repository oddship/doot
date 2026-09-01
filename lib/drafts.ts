import { z } from "zod";
import { accountByName, db, json, now } from "@/lib/database";
import { appendImapDraft } from "@/lib/imap";

const address = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .refine((value) => !/[\r\n]/.test(value), "invalid address");
const reference = z
  .object({
    account: z.string().min(1).max(160),
    uid: z.string().regex(/^\d+$/),
    folder: z.string().min(1).max(500).optional(),
  })
  .strict();

const localDraftSchema = z
  .object({
    account: z.string().min(1).max(160),
    to: z.array(address).max(50).default([]),
    cc: z.array(address).max(50).default([]),
    bcc: z.array(address).max(50).default([]),
    subject: z.string().max(998).default(""),
    body: z.string().max(200_000).default(""),
    in_reply_to: z.string().max(998).optional(),
    references: z.array(z.string().max(998)).max(50).default([]),
    context_messages: z.array(reference).max(20).default([]),
  })
  .strict();

export type LocalDraftContent = z.infer<typeof localDraftSchema>;

function rowValue(row: any) {
  return {
    id: Number(row.id),
    kind: "draft" as const,
    title: row.title,
    content: localDraftSchema.parse(json(row.content_json, {})),
    status: row.status,
    created_at: row.created_at,
  };
}

export function listDrafts() {
  return {
    drafts: (
      db
        .prepare(
          "SELECT id,kind,title,content_json,status,created_at FROM agent_artifacts WHERE kind='draft' ORDER BY id DESC LIMIT 200",
        )
        .all() as any[]
    ).flatMap((row) => {
      try {
        return [rowValue(row)];
      } catch {
        // Legacy free-form artifacts stay available in Settings, but are not
        // safe to treat as structured drafts or upload to IMAP.
        return [];
      }
    }),
  };
}

export function getDraft(id: number) {
  const row = db
    .prepare("SELECT id,kind,title,content_json,status,created_at FROM agent_artifacts WHERE kind='draft' AND id=?")
    .get(id);
  if (!row) throw new Error("draft not found");
  return { draft: rowValue(row) };
}

export function saveLocalDraft(value: unknown, id?: number) {
  const content = localDraftSchema.parse(value);
  if (!accountByName(content.account)) throw new Error("unknown account");
  const title = (content.subject.trim() || `Draft to ${content.to[0] || "recipient"}`).slice(0, 200);
  if (id) {
    const info = db
      .prepare("UPDATE agent_artifacts SET title=?,content_json=?,status='draft' WHERE id=? AND kind='draft'")
      .run(title, JSON.stringify(content), id);
    if (!info.changes) throw new Error("draft not found");
    return getDraft(id).draft;
  }
  const info = db
    .prepare("INSERT INTO agent_artifacts(kind,title,content_json,status,created_at) VALUES('draft',?,?,'draft',?)")
    .run(title, JSON.stringify(content), now());
  return getDraft(Number(info.lastInsertRowid)).draft;
}

export function deleteLocalDraft(id: number) {
  const draft = getDraft(id).draft;
  db.prepare("DELETE FROM agent_artifacts WHERE id=? AND kind='draft'").run(id);
  return { deleted: id, imap_copy_retained: draft.status === "saved" };
}

export async function saveDraftToImap(id: number) {
  const draft = getDraft(id).draft;
  if (!draft.content.to.length) throw new Error("add at least one To recipient before saving to IMAP");
  if (!draft.content.subject.trim() && !draft.content.body.trim()) throw new Error("the draft is empty");
  const saved = await appendImapDraft(draft.content.account, draft.content);
  db.prepare("UPDATE agent_artifacts SET status='saved' WHERE id=? AND kind='draft'").run(id);
  return { draft: getDraft(id).draft, imap: saved };
}
