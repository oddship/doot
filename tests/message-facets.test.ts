// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCanonicalSql, legacyFacets } from "./helpers/message-query-baseline";

const directory = mkdtempSync(path.join(tmpdir(), "doot-query-facets-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite3");
const { db, messageWhere, queryMessages } = await import("@/lib/database");
const { messageFacets } = await import("@/lib/message-facets");
db.exec(`CREATE TEMP VIEW legacy_canonical_messages AS ${legacyCanonicalSql}`);
const timestamp = 2000000000;
const insert = db.prepare(
  `INSERT INTO messages(account,account_email,folder,uid,provider_id,sender,subject,date_ts,present,body_text,body_html,body_fetched,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
);
function seed(
  account: string,
  folder: string,
  uid: string,
  provider: string,
  date: number,
  sender = "Sender <alerts@Example.COM>",
  present = 1,
) {
  insert.run(
    account,
    `${account}@example.com`,
    folder,
    uid,
    provider,
    sender,
    "Puzzle receipt",
    date,
    present,
    "cached text ".repeat(1000),
    "<p>cached HTML</p>".repeat(1000),
    1,
    "now",
  );
}
beforeEach(() => {
  db.exec("DELETE FROM messages");
  vi.spyOn(Date, "now").mockReturnValue(timestamp * 1000);
});
afterAll(() => {
  vi.restoreAllMocks();
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("lightweight canonical ranking and single-pass facets", () => {
  it("returns exactly the same canonical rows, including bodies and rank", () => {
    seed("a", "Receipts", "9", "shared", timestamp);
    seed("a", "[Gmail]/All Mail", "10", "shared", timestamp);
    seed("a", "INBOX", "11", "shared", timestamp);
    seed("a", "News", "2", "other", timestamp);
    seed("a", "news", "10", "other", timestamp);
    seed("a", "Archive", "7", "", timestamp);
    seed("a", "INBOX", "7", "", timestamp);
    seed("b", "INBOX", "11", "shared", timestamp);
    seed("a", "INBOX", "99", "hidden", timestamp, undefined, 0);
    const order = " ORDER BY account,folder,CAST(uid AS INTEGER)";
    expect(db.prepare(`SELECT * FROM canonical_messages${order}`).all()).toEqual(
      db.prepare(`SELECT * FROM legacy_canonical_messages${order}`).all(),
    );
    expect(queryMessages({ account: "a", query: "puzzle", includeBodyFetched: true }).total).toBe(4);
    expect(
      queryMessages({ account: "a", query: "puzzle", focusUid: "11", focusFolder: "INBOX", limit: 1 }),
    ).toMatchObject({ focus_found: true, total: 4 });
    // Filtering must remain AFTER canonical selection: a duplicate's sender
    // must not make an otherwise non-matching winner appear in search results.
    seed("a", "Archive", "21", "filter-check", timestamp, "match@example.com");
    seed("a", "INBOX", "22", "filter-check", timestamp, "different@example.com");
    expect(queryMessages({ query: "from:match@example.com" }).total).toBe(0);
  });
  it("matches all legacy facet results across filters, duplicates, Unicode ties and age boundaries", () => {
    const dates = [
      timestamp,
      timestamp - 86400,
      timestamp - 86400 - 1,
      timestamp - 7 * 86400,
      timestamp - 7 * 86400 - 1,
      timestamp - 30 * 86400,
      timestamp - 30 * 86400 - 1,
      0,
      -1,
      timestamp + 1,
    ];
    const senders = [
      "A <a@example.com>",
      "z@example.com",
      "é@example.net",
      "\uE000@example.org",
      "😀@example.org",
      "no address",
    ];
    dates.forEach((date, i) => {
      seed(i % 2 ? "b" : "a", "INBOX", String(i + 1), `m${i}`, date, senders[i % senders.length]);
    });
    seed("a", "Archive", "101", "m0", timestamp, "loser@other.net");
    seed("b", "INBOX", "102", "hidden", timestamp, undefined, 0);
    for (const input of [
      {},
      { account: "a" },
      { account: "b", days: 7 },
      { query: "subject:puzzle", limit: 5 },
      { query: "domain:example.org" },
      { query: "from:no" },
      { query: "receipt" },
      { query: "nonexistent" },
      { limit: 1 },
      { limit: 100 },
    ]) {
      const { where, values } = messageWhere(input);
      expect(messageFacets(input)).toEqual(legacyFacets(db, input, where, values, timestamp));
    }
  });
  it("uses just one metadata-only SELECT for all aggregates", () => {
    seed("a", "INBOX", "1", "m1", timestamp);
    const spy = vi.spyOn(db, "prepare");
    try {
      expect(messageFacets({}).total).toBe(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain("SELECT account,account_email,sender,date_ts");
      expect(spy.mock.calls[0][0]).not.toMatch(/body_text|body_html/);
    } finally {
      spy.mockRestore();
    }
  });
  it("shares dashboard account counts and totals without changing the response shape", async () => {
    const { store } = await import("@/lib/store");
    expect((await store<any>(["dashboard"])).totals).toEqual({ cached: 0, bodies: null });
    seed("a", "INBOX", "1", "m1", timestamp);
    seed("a", "Archive", "2", "m1", timestamp);
    seed("b", "INBOX", "3", "m3", timestamp);
    db.prepare("UPDATE messages SET body_fetched=0 WHERE account='b'").run();
    const spy = vi.spyOn(db, "prepare");
    try {
      const result = await store<any>(["dashboard"]);
      expect(result.totals).toEqual({ cached: 2, bodies: 1 });
      expect(result.accounts).toEqual([
        { account: "a", account_email: "a@example.com", cached: 1, last_sync: null, last_error: null },
        { account: "b", account_email: "b@example.com", cached: 1, last_sync: null, last_error: null },
      ]);
      expect(spy.mock.calls.filter(([sql]) => sql.includes("FROM canonical_messages"))).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps counts fresh after visibility and header changes without a stale cache", () => {
    seed("a", "INBOX", "1", "m1", timestamp);
    expect(messageFacets({}).total).toBe(1);
    db.prepare("UPDATE messages SET sender='new@example.net' WHERE uid='1'").run();
    expect(messageFacets({}).top_domains).toEqual([{ name: "example.net", count: 1 }]);
    db.prepare("UPDATE messages SET present=0 WHERE uid='1'").run();
    expect(messageFacets({})).toMatchObject({
      total: 0,
      accounts: [],
      top_senders: [],
      top_domains: [],
      age_buckets: [
        { label: "last_24_hours", count: 0 },
        { label: "last_7_days", count: 0 },
        { label: "last_30_days", count: 0 },
        { label: "older", count: 0 },
      ],
    });
  });
});
