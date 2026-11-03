// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "doot-app-state-"));
process.env.DOOT_DATABASE_PATH = path.join(dir, "cache.sqlite");
const { db } = await import("@/lib/database");
const { getAppState, setAppState, getActiveConversationId } = await import("@/lib/app-state");
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(dir, { recursive: true, force: true });
});
it("restores shared selection and composer from SQLite and hides internal state", () => {
  setAppState("email-agent:selected-messages:v1", ["fake\u001fINBOX\u001f12"]);
  setAppState("doot:agent-composer:v1", "Unsubmitted synthetic task");
  db.prepare("INSERT INTO app_state(key,value_json) VALUES('private-state','{\"secret\":true}')").run();
  expect(getAppState()).toMatchObject({
    "email-agent:selected-messages:v1": ["fake\u001fINBOX\u001f12"],
    "doot:agent-composer:v1": "Unsubmitted synthetic task",
  });
  expect(getAppState()["private-state"]).toBeUndefined();
  expect(() => setAppState("email-agent:selected-messages:v1", ["invalid-reference"])).toThrow();
});
it("requires a saved agent conversation and supports explicit new conversation", () => {
  expect(() => setAppState("email-agent:conversation:v1", { sessionId: "missing-session" })).toThrow(
    "Conversation not found",
  );
  db.prepare(
    "INSERT INTO agent_sessions(id,title,started_at,updated_at) VALUES('saved-session','Test','now','now')",
  ).run();
  setAppState("email-agent:conversation:v1", { sessionId: "saved-session" });
  expect(getActiveConversationId()).toBe("saved-session");
  setAppState("email-agent:conversation:v1", null);
  expect(getActiveConversationId()).toBeUndefined();
});
it("autosaves local draft edits in SQLite without uploading", () => {
  db.prepare(
    "INSERT INTO email_accounts(name,host,username,password,created_at,updated_at) VALUES('fake','imap.test','fake@example.test','dummy','now','now')",
  ).run();
  const content = {
    account: "fake",
    to: [],
    cc: [],
    bcc: [],
    subject: "Before",
    body: "Before",
    references: [],
    context_messages: [],
  };
  const id = Number(
    db
      .prepare(
        "INSERT INTO agent_artifacts(kind,title,content_json,status,created_at) VALUES('draft','Before',?,'draft','now')",
      )
      .run(JSON.stringify(content)).lastInsertRowid,
  );
  setAppState(`doot:draft-editor:${id}`, { ...content, subject: "After", body: "Saved locally" });
  const row = db.prepare("SELECT content_json,status FROM agent_artifacts WHERE id=?").get(id) as any;
  expect(JSON.parse(row.content_json).body).toBe("Saved locally");
  expect(row.status).toBe("draft");
  expect(db.prepare("SELECT COUNT(*) count FROM background_jobs").get()).toEqual({ count: 0 });
});
