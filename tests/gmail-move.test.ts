// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  mode: "success",
  source: new Set<number>(),
  seen: false,
  clients: [] as any[],
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    capabilities = new Set(["X-GM-EXT-1", "MOVE"]);
    folder = "INBOX";
    mailbox: any;
    on = vi.fn(() => this);
    connect = vi.fn(async () => {});
    logout = vi.fn(async () => {});
    close = vi.fn();
    mailboxOpen = vi.fn(async (folder: string) => {
      this.folder = folder;
      this.mailbox = { uidValidity: folder === "project" ? 77n : 7n };
      return this.mailbox;
    });
    getMailboxLock = vi.fn(async (folder: string) => {
      await this.mailboxOpen(folder);
      return { release: vi.fn() };
    });
    fetchAll = vi.fn(async (uids: number[]) => {
      if (this.folder === "project") {
        if (fake.mode === "missing") return [];
        return uids.map((uid) => ({
          uid,
          emailId: fake.mode === "identity" ? "wrong" : `stable-${uid - 100}`,
          flags: new Set(fake.seen || fake.mode === "seen" ? ["\\Seen"] : []),
        }));
      }
      return uids
        .filter((uid) => fake.source.has(uid))
        .map((uid) => ({
          uid,
          emailId: `stable-${uid}`,
          flags: new Set(fake.seen ? ["\\Seen"] : []),
        }));
    });
    messageMove = vi.fn(async (uid: number) => {
      if (fake.mode === "reject") return false;
      if (fake.mode !== "noop") fake.source.delete(uid);
      return fake.mode === "mapping" ? {} : { uidValidity: 77n, uidMap: new Map([[uid, uid + 100]]) };
    });
    messageFlagsAdd = vi.fn(async (_uids: unknown, flags: string[], options: any) => {
      if (!options?.useLabels && flags.includes("\\Seen")) fake.seen = true;
      return true;
    });
    messageFlagsRemove = vi.fn(async () => true);
    constructor() {
      if (fake.mode === "no-move") this.capabilities.delete("MOVE");
      fake.clients.push(this);
    }
  },
}));

const directory = mkdtempSync(path.join(tmpdir(), "doot-gmail-move-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite3");
const { db } = await import("@/lib/database");
const { applyMailboxActions, createMailboxActionSession } = await import("@/lib/imap");
db.prepare("INSERT INTO email_accounts(name,host,username,password,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
  "demo",
  "imap.gmail.com",
  "demo@example.test",
  "dummy",
  "now",
  "now",
);

beforeEach(() => {
  db.exec("DELETE FROM messages; DELETE FROM sync_state; DELETE FROM imap_folders;");
  fake.mode = "success";
  fake.source = new Set([1, 2]);
  fake.seen = false;
  fake.clients.length = 0;
  for (const uid of [1, 2])
    db.prepare(
      "INSERT INTO messages(account,account_email,uid,folder,sender,subject,unread,present,fetched_at) VALUES(?,?,?,?,?,?,1,1,?)",
    ).run("demo", "demo@example.test", String(uid), "INBOX", "sender@example.test", "Fixture", "now");
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
const item = (uid = "1", source_folder = "INBOX") => ({
  account: "demo",
  uid,
  source_folder,
  folder: "project",
  uid_validity: "7",
});

describe("verified Gmail moves", () => {
  it("reuses one job-owned connection while verifying and receipting separate messages", async () => {
    const session = createMailboxActionSession();
    try {
      for (const uid of ["1", "2"]) {
        const result = await applyMailboxActions(["move"], [item(uid)], session);
        expect(result.status).toBe("applied");
        expect(result.results[0].destination_verified).toBe(true);
      }
      expect(fake.clients).toHaveLength(1);
      expect(fake.clients[0].connect).toHaveBeenCalledOnce();
      expect(fake.clients[0].logout).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
    expect(fake.clients[0].logout).toHaveBeenCalledOnce();
  });
  it("uses native MOVE and verifies source absence, stable destination identity and unread state without bodies", async () => {
    const result = await applyMailboxActions(["move"], [item(), item("2")]);
    expect(result.status).toBe("applied");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({
      source_absence_verified: true,
      destination_verified: true,
      unread_state_verified: true,
      destination_uid: "101",
    });
    expect(fake.clients[0].messageMove).toHaveBeenCalledTimes(2);
    expect(fake.clients[0].messageFlagsAdd).not.toHaveBeenCalled();
    expect(fake.clients[0].messageFlagsRemove).not.toHaveBeenCalled();
    expect(fake.clients[0].fetchAll.mock.calls.every((call: any[]) => !call[1]?.source)).toBe(true);
    expect(db.prepare("SELECT unread,present FROM messages WHERE uid='1'").get()).toEqual({ unread: 1, present: 0 });
  });
  it.each(["noop", "missing", "identity", "seen", "mapping", "reject", "no-move"])(
    "does not hide mail after an unverified %s result",
    async (mode) => {
      fake.mode = mode;
      const result = await applyMailboxActions(["move"], [item()]);
      expect(result.status).toBe("partial_failure");
      expect(result.errors).not.toHaveLength(0);
      expect(db.prepare("SELECT unread,present FROM messages WHERE uid='1'").get()).toEqual({ unread: 1, present: 1 });
    },
  );
  it("verifies the requested seen state for an explicitly approved mark-read plus move", async () => {
    const result = await applyMailboxActions(["mark_read", "move"], [item()]);
    expect(result.status).toBe("applied");
    expect(db.prepare("SELECT unread,present FROM messages WHERE uid='1'").get()).toEqual({ unread: 0, present: 0 });
  });
  it("keeps All Mail filing label-only instead of moving the retained canonical message", async () => {
    db.prepare("UPDATE messages SET folder='All Mail'").run();
    db.prepare(
      "INSERT INTO imap_folders(account,path,name,special_use,discovered_at) VALUES('demo','All Mail','All Mail','\\All','now')",
    ).run();
    const result = await applyMailboxActions(["move"], [item("1", "All Mail")]);
    expect(result.status).toBe("applied");
    expect(fake.clients[0].messageMove).not.toHaveBeenCalled();
    expect(fake.clients[0].messageFlagsAdd).toHaveBeenCalledWith(
      1,
      ["project"],
      expect.objectContaining({ useLabels: true }),
    );
    expect(db.prepare("SELECT present FROM messages WHERE uid='1'").get()).toEqual({ present: 1 });
  });
});
