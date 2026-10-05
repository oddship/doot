// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactSource } from "./source-contract";

describe("IMAP adapter contract", () => {
  it("uses BODY.PEEK semantics, read-only mailbox locks, and cached bodies", async () => {
    const source = compactSource(await readFile("lib/imap.ts", "utf8"));
    const bodyReader = compactSource(await readFile("lib/imap-body-read.ts", "utf8"));
    expect(bodyReader).toContain("source: true");
    expect(bodyReader).toContain("BODY.PEEK[]");
    expect(source).toContain("getMailboxLock(folder, { readOnly");
    expect(source).toContain("if (cached.get(key))");
    expect(source).toContain("SELECT body_fetched FROM messages");
    expect(source).toContain("pendingBodyReads");
  });
  it("reuses bounded read-only IMAP sessions and disposes them after idle time", async () => {
    const source = compactSource(await readFile("lib/imap.ts", "utf8"));
    expect(source).toContain("const READ_SESSION_IDLE_MS = 10 * 60_000");
    expect(source).toContain("const MAX_READ_SESSIONS = 12");
    expect(source).toContain("withReusableReadMailbox");
    expect(source).toContain('description: "Doot reusable read"');
    expect(source).toContain("session.queue.then");
    expect(source).toContain("scheduleReadSessionIdleClose(session)");
    expect(source).toContain("closeAccountReadSessions");
  });
  it("migrates workspaces and folder-scoped identities without losing cached rows", async () => {
    const source = await readFile("lib/database.ts", "utf8");
    expect(source).toContain("ALTER TABLE agent_views ADD COLUMN schema_version");
    expect(source).toContain("ALTER TABLE messages RENAME TO messages_legacy");
    expect(source).toContain("INSERT INTO messages(");
    expect(source).toContain("PRIMARY KEY(account,folder,uid)");
    expect(source).toContain("PRIMARY KEY(account,folder)");
  });
  it("provides synchronized FTS5 search and namespaced JSON memory", async () => {
    const database = await readFile("lib/database.ts", "utf8");
    const store = await readFile("lib/store.ts", "utf8");
    expect(database).toContain("CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5");
    expect(database).toContain("messages_fts_update");
    expect(database).toContain("CREATE TABLE IF NOT EXISTS agent_memory");
    expect(store).toContain('case "memory-delete"');
  });
  it("keeps mailbox writes behind the explicit apply path", async () => {
    const source = await readFile("lib/imap.ts", "utf8");
    expect(source).toContain('description: readOnly ? "Doot read" : "Confirmed mailbox action"');
    expect(source).toContain("export async function applyMailboxAction");
  });
  it("hides applied and absent messages from cache-backed reads", async () => {
    const imap = await readFile("lib/imap.ts", "utf8");
    const store = await readFile("lib/store.ts", "utf8");
    expect(imap).toContain("UPDATE messages SET present=0 WHERE account=? AND folder=? AND uid=?");
    expect(imap).toContain("SELECT * FROM messages WHERE account=? AND folder=? AND uid=? AND present=1");
    expect(store).toContain("FROM canonical_messages");
  });
});
