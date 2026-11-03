import { z } from "zod";
import { db, json } from "@/lib/database";
import { saveLocalDraft } from "@/lib/drafts";

const reference = z.object({
  account: z.string().min(1).max(200),
  uid: z.string().regex(/^\d+$/),
  folder: z.string().min(1).max(500).optional(),
});
const schemas: Record<string, z.ZodType> = {
  "email-agent:conversation:v1": z.object({ sessionId: z.string().min(8).max(100).optional() }).nullable(),
  "email-agent:selected-messages:v1": z.array(z.string().max(1000)).max(100),
  "email-agent:selected-rule:v1": z.object({ id: z.number().int().positive(), name: z.string().max(160) }).nullable(),
  "doot:selected-draft:v1": z.object({ id: z.number().int().positive(), title: z.string().max(200) }).nullable(),
  "doot:selected-search:v1": z
    .object({ account: z.string().min(1).max(200), query: z.string().min(1).max(500) })
    .nullable(),
  "doot:agent-composer:v1": z.string().max(50000).nullable(),
  "doot:agent-handoff:v1": z.object({ prompt: z.string().max(20000) }).nullable(),
};
export function getAppState() {
  return Object.fromEntries(
    (
      db
        .prepare(
          `SELECT key,value_json FROM app_state WHERE key IN (${Object.keys(schemas)
            .map(() => "?")
            .join(",")})`,
        )
        .all(...Object.keys(schemas)) as any[]
    )
      .filter((row) => row.key in schemas)
      .map((row) => [row.key, json(row.value_json, null)]),
  );
}
export function setAppState(key: string, value: unknown) {
  const editor = /^doot:draft-editor:(\d+)$/.exec(key);
  if (editor) return saveLocalDraft(value, Number(editor[1])).content;
  if (!(key in schemas)) throw new Error("Unknown app state key");
  const parsed: any = schemas[key].parse(value);
  if (
    key === "email-agent:conversation:v1" &&
    parsed?.sessionId &&
    !db.prepare("SELECT 1 FROM agent_sessions WHERE id=? AND history_kind='agent'").get(parsed.sessionId)
  )
    throw new Error("Conversation not found");
  if (key === "email-agent:selected-messages:v1") {
    for (const id of parsed) {
      const [account, folder, uid, ...extra] = id.split("\u001f");
      if (extra.length) throw new Error("Invalid selected reference");
      if (uid) reference.parse({ account, folder: folder || undefined, uid });
      else if (!/^.+:\d+$/.test(id)) throw new Error("Invalid selected reference");
    }
  }
  db.prepare(
    "INSERT INTO app_state(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
  ).run(key, JSON.stringify(parsed));
  return parsed;
}
export function getActiveConversationId(): string | undefined {
  return (getAppState()["email-agent:conversation:v1"] as any)?.sessionId;
}
