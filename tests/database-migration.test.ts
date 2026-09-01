// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import LegacyDatabase from "better-sqlite3";
import { afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "doot-folder-migration-"));
const databasePath = path.join(directory, "cache.sqlite3");
const legacy = new LegacyDatabase(databasePath);
legacy.exec(`
  CREATE TABLE messages (
    account TEXT NOT NULL, account_email TEXT NOT NULL, uid TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT 'INBOX', sender TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '', date_ts INTEGER NOT NULL DEFAULT 0,
    body_text TEXT NOT NULL DEFAULT '', body_html TEXT NOT NULL DEFAULT '', attachments_json TEXT NOT NULL DEFAULT '[]',
    body_fetched INTEGER NOT NULL DEFAULT 0, flags_json TEXT NOT NULL DEFAULT '[]', labels_json TEXT NOT NULL DEFAULT '[]',
    unread INTEGER NOT NULL DEFAULT 0, present INTEGER NOT NULL DEFAULT 1, fetched_at TEXT NOT NULL,
    PRIMARY KEY(account,uid));
  CREATE TABLE sync_state (
    account TEXT PRIMARY KEY, last_uid INTEGER NOT NULL DEFAULT 0, last_sync TEXT, last_error TEXT,
    uid_validity TEXT, uid_next INTEGER, highest_modseq TEXT, mailbox_messages INTEGER,
    mailbox_unseen INTEGER, sync_days INTEGER, sync_limit INTEGER);
  INSERT INTO messages(account,account_email,uid,folder,sender,subject,body_text,body_fetched,fetched_at)
  VALUES('work','work@example.com','12','INBOX','sender@example.com','Migration check','kept body',1,'now');
  INSERT INTO sync_state(account,last_uid,uid_validity) VALUES('work',12,'7');
`);
legacy.close();
process.env.DOOT_DATABASE_PATH = databasePath;

const database = await import("@/lib/database");

afterAll(() => {
  database.db.close();
  delete (globalThis as typeof globalThis & { __emailAgentDatabase?: unknown }).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("folder-scoped SQLite migration", () => {
  it("preserves cached bodies and rebuilds folder-aware keys and FTS", () => {
    const messageKey = (database.db.prepare("PRAGMA table_info(messages)").all() as any[])
      .filter((row) => row.pk)
      .sort((left, right) => left.pk - right.pk)
      .map((row) => row.name);
    const syncKey = (database.db.prepare("PRAGMA table_info(sync_state)").all() as any[])
      .filter((row) => row.pk)
      .sort((left, right) => left.pk - right.pk)
      .map((row) => row.name);
    expect(messageKey).toEqual(["account", "folder", "uid"]);
    expect(syncKey).toEqual(["account", "folder"]);
    expect(database.db.prepare("SELECT folder,body_text,body_fetched FROM messages").get()).toEqual({
      folder: "INBOX",
      body_text: "kept body",
      body_fetched: 1,
    });
    expect(database.db.prepare("SELECT folder,uid_validity FROM sync_state").get()).toEqual({
      folder: "INBOX",
      uid_validity: "7",
    });
    expect(database.queryMessages({ query: "migration" }).total).toBe(1);
  });

  it("canonicalizes overlapping provider messages while retaining folder rows", () => {
    const insert = database.db.prepare(`INSERT INTO messages(
      account,account_email,uid,folder,sender,subject,provider_id,present,fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    insert.run("work", "work@example.com", "20", "Receipts", "sender@example.com", "Duplicate alert", "m-1", 1, "now");
    insert.run("work", "work@example.com", "21", "INBOX", "sender@example.com", "Duplicate alert", "m-1", 1, "now");

    expect(database.db.prepare("SELECT COUNT(*) count FROM messages WHERE provider_id='m-1'").get()).toEqual({
      count: 2,
    });
    expect(database.queryMessages({ query: "duplicate" })).toMatchObject({
      total: 1,
      messages: [{ folder: "INBOX", provider_id: "m-1" }],
    });
  });
});
