// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactSource } from "./source-contract";

describe("IMAP adapter contract", () => {
  it("uses BODY.PEEK semantics, read-only mailbox locks, and cached bodies", async () => {
    const source = compactSource(await readFile("lib/imap.ts", "utf8"));
    expect(source).toContain("source: true");
    expect(source).toContain("BODY.PEEK[]");
    expect(source).toContain("getMailboxLock(folder, { readOnly");
    expect(source).toContain("if (!existing.body_fetched)");
  });
  it("migrates workspaces without recreating the database", async () => {
    const source = await readFile("lib/database.ts", "utf8");
    expect(source).toContain("ALTER TABLE agent_views ADD COLUMN schema_version");
    expect(source).not.toContain("DROP TABLE");
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
});
