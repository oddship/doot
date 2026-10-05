// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  clients: [] as any[],
  sources: new Map<string, string>(),
  sourceHook: undefined as (() => void) | undefined,
  fail: false,
  validity: 7,
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    folder = "";
    mailbox: any;
    on = vi.fn(() => this);
    connect = vi.fn(async () => {});
    logout = vi.fn(async () => {});
    close = vi.fn();
    getMailboxLock = vi.fn(async (folder: string, _options: any) => {
      this.folder = folder;
      this.mailbox = { uidValidity: fake.validity };
      return { release: vi.fn() };
    });
    fetchAll = vi.fn(async (uids: number[], query: any, _options: any) => {
      if (fake.fail) {
        fake.fail = false;
        throw new Error("Transient fetch error");
      }
      if (query.source) fake.sourceHook?.();
      return [...uids].reverse().flatMap((uid) => {
        const raw = fake.sources.get(`${this.folder}:${uid}`);
        if (!raw) return [];
        return [{ uid, ...(query.size ? { size: Buffer.byteLength(raw) } : { source: Buffer.from(raw) }) }];
      });
    });
    constructor() {
      fake.clients.push(this);
    }
  },
}));
const directory = mkdtempSync(path.join(tmpdir(), "doot-body-batch-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite3");
const { db } = await import("@/lib/database");
const { readMessages, readMessage, closeAccountReadSessions } = await import("@/lib/imap");
db.prepare("INSERT INTO email_accounts(name,host,username,password,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
  "work",
  "imap.example.test",
  "work@example.test",
  "dummy",
  "now",
  "now",
);
const refs = (count: number, folder = "INBOX") =>
  Array.from({ length: count }, (_, i) => ({ account: "work", folder, uid: String(i + 1) }));
function seed(count: number, folder = "INBOX", cached = false) {
  const insert = db.prepare(
    "INSERT INTO messages(account,account_email,uid,folder,sender,subject,unread,body_fetched,body_text,fetched_at) VALUES(?,?,?,?,?,?,1,?,?,?)",
  );
  for (let uid = 1; uid <= count; uid++) {
    insert.run(
      "work",
      "work@example.test",
      String(uid),
      folder,
      "sender@example.test",
      `Message ${uid}`,
      Number(cached),
      cached ? `Cached ${uid}` : "",
      "now",
    );
    fake.sources.set(
      `${folder}:${uid}`,
      `From: sender@example.test\r\nTo: work@example.test\r\nSubject: Message ${uid}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody ${folder} ${uid}\r\n`,
    );
  }
}
beforeEach(() => {
  db.exec("DELETE FROM messages; DELETE FROM sync_state;");
  fake.clients.length = 0;
  fake.sources.clear();
  fake.sourceHook = undefined;
  fake.fail = false;
  fake.validity = 7;
});
afterEach(async () => {
  await closeAccountReadSessions("work");
});
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("cache-first coalesced IMAP body reads", () => {
  it("fetches five bodies in one mailbox lock with two commands, preserves order and unread state", async () => {
    seed(5);
    const result = await readMessages(refs(5));
    expect(result.messages.map((m) => m.uid)).toEqual(["1", "2", "3", "4", "5"]);
    expect(result.messages[0].body_text).toContain("Body INBOX 1");
    expect(result.metrics).toMatchObject({
      network_messages: 5,
      metadata_fetches: 1,
      source_fetches: 1,
      cache_hits: 0,
    });
    expect(fake.clients).toHaveLength(1);
    expect(fake.clients[0].getMailboxLock).toHaveBeenCalledTimes(1);
    expect(fake.clients[0].getMailboxLock).toHaveBeenCalledWith("INBOX", expect.objectContaining({ readOnly: true }));
    expect(db.prepare("SELECT SUM(unread) unread,SUM(body_fetched) cached FROM messages").get()).toEqual({
      unread: 5,
      cached: 5,
    });
  });
  it("does not open IMAP at all for cached bodies and fetches only cache misses", async () => {
    seed(5, "INBOX", true);
    const cached = await readMessages(refs(5));
    expect(cached.metrics.cache_hits).toBe(5);
    expect(fake.clients).toHaveLength(0);
    db.prepare("UPDATE messages SET body_fetched=0 WHERE uid='3'").run();
    const mixed = await readMessages(refs(5));
    expect(mixed.metrics).toMatchObject({ cache_hits: 4, network_messages: 1, metadata_fetches: 1, source_fetches: 1 });
    expect(fake.clients[0].fetchAll.mock.calls[0][0]).toEqual([3]);
  });
  it("coalesces overlapping simultaneous requests, including duplicate references", async () => {
    seed(5);
    const [one, two] = await Promise.all([readMessages([...refs(5), refs(5)[0]]), readMessages(refs(5))]);
    expect(one.messages).toHaveLength(6);
    expect(two.messages).toHaveLength(5);
    expect(one.metrics.network_messages + two.metrics.network_messages).toBe(5);
    expect(two.metrics.coalesced).toBe(5);
    expect(fake.clients[0].fetchAll).toHaveBeenCalledTimes(2);
  });
  it("keeps identical UIDs in different folders separate and reuses the single-message path", async () => {
    seed(1);
    seed(1, "Archive");
    const result = await readMessages([...refs(1), ...refs(1, "Archive")]);
    expect(result.messages.map((m) => m.body_text)).toEqual([
      expect.stringContaining("INBOX"),
      expect.stringContaining("Archive"),
    ]);
    const single = await readMessage("work", "1", "Archive");
    expect(single.body_text).toContain("Archive");
    expect(single.read_metrics.cache_hits).toBe(1);
    expect(fake.clients).toHaveLength(2);
  });
  it("validates the whole reference set before network work", async () => {
    seed(1);
    await expect(readMessages([...refs(1), { account: "work", folder: "Archive", uid: "1" }])).rejects.toThrow(
      "no longer available",
    );
    expect(fake.clients).toHaveLength(0);
  });
  it("never caches a body under reused UIDs after UIDVALIDITY changes", async () => {
    seed(1);
    db.prepare("INSERT INTO sync_state(account,folder,uid_validity) VALUES('work','INBOX','7')").run();
    fake.validity = 8;
    await expect(readMessages(refs(1))).rejects.toThrow("UID validity changed");
    expect(fake.clients[0].fetchAll).not.toHaveBeenCalled();
    expect(db.prepare("SELECT body_fetched FROM messages").get()).toEqual({ body_fetched: 0 });
  });
  it("rejects cache writes if another sync changes UIDVALIDITY during the fetch", async () => {
    seed(1);
    db.prepare("INSERT INTO sync_state(account,folder,uid_validity) VALUES('work','INBOX','7')").run();
    fake.sourceHook = () => db.prepare("UPDATE sync_state SET uid_validity='8' WHERE account='work'").run();
    await expect(readMessages(refs(1))).rejects.toThrow("UID validity changed");
    expect(db.prepare("SELECT body_fetched FROM messages").get()).toEqual({ body_fetched: 0 });
  });

  it("does not resurrect a message removed while its body was being fetched", async () => {
    seed(2);
    fake.sourceHook = () => db.prepare("UPDATE messages SET present=0 WHERE uid='2'").run();
    await expect(readMessages(refs(2))).rejects.toThrow("no longer available");
    expect(db.prepare("SELECT SUM(body_fetched) cached FROM messages").get()).toEqual({ cached: 0 });
  });
  it("cleans up failed in-flight reads and reconnects on the next request", async () => {
    seed(1);
    fake.fail = true;
    await expect(readMessages(refs(1))).rejects.toThrow("Transient fetch error");
    const result = await readMessages(refs(1));
    expect(result.messages[0].body_text).toContain("Body INBOX 1");
    expect(fake.clients).toHaveLength(2);
    expect(fake.clients[0].close).toHaveBeenCalled();
  });
});
