// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROPOSAL_ITEM_LIMIT, MAX_PROPOSAL_ITEMS } from "@/lib/proposal-limits";

const directory = mkdtempSync(path.join(tmpdir(), "doot-proposal-source-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite3");

const database = await import("@/lib/database");
const { store } = await import("@/lib/store");

afterAll(() => {
  database.db.close();
  delete (globalThis as typeof globalThis & { __emailAgentDatabase?: unknown }).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});

beforeEach(() => {
  database.db.prepare("DELETE FROM actions").run();
  database.db.prepare("DELETE FROM messages").run();
  database.db
    .prepare(`INSERT INTO messages(account,account_email,uid,folder,subject,present,fetched_at)
      VALUES('work','work@example.com','12','Archive','Exact message',1,'now')`)
    .run();
});

describe("folder-scoped proposal safety", () => {
  function seedBatch(count: number) {
    const items = Array.from({ length: count }, (_, index) => ({
      account: "work",
      uid: String(index + 100),
      source_folder: "Archive",
    }));
    database.db.transaction(() => {
      const insert = database.db.prepare(
        "INSERT INTO messages(account,account_email,uid,folder,subject,present,fetched_at) VALUES(?,'work@example.com',?,?,'Batch message',1,'now')",
      );
      for (const item of items) insert.run(item.account, item.uid, item.source_folder);
    })();
    return items;
  }

  it.each([42, 1000])("keeps all %i messages in one reviewable proposal", async (count) => {
    await store(["settings-set", JSON.stringify({ proposal_item_limit: 1000 })]);
    const items = seedBatch(count);
    const proposal = await store<any>(["propose", "archive", JSON.stringify(items)]);
    expect(proposal).toMatchObject({ action: "archive", status: "proposed", items });
    expect(database.db.prepare("SELECT count(*) AS count FROM messages WHERE present=1").get()).toEqual({
      count: count + 1,
    });
  });

  it("rejects oversized batches before storing a proposal", async () => {
    await store(["settings-set", JSON.stringify({ proposal_item_limit: DEFAULT_PROPOSAL_ITEM_LIMIT })]);
    const items = seedBatch(DEFAULT_PROPOSAL_ITEM_LIMIT + 1);
    await expect(store(["propose", "archive", JSON.stringify(items)])).rejects.toThrow(
      `1–${DEFAULT_PROPOSAL_ITEM_LIMIT}`,
    );
    expect(database.db.prepare("SELECT count(*) AS count FROM actions").get()).toEqual({ count: 0 });
  });

  it("validates source identity for every item in a large batch", async () => {
    await store(["settings-set", JSON.stringify({ proposal_item_limit: 1000 })]);
    const items = seedBatch(1000);
    items[items.length - 1].source_folder = "INBOX";
    await expect(store(["propose", "archive", JSON.stringify(items)])).rejects.toThrow("not in the local cache");
    expect(database.db.prepare("SELECT count(*) AS count FROM actions").get()).toEqual({ count: 0 });
  });

  it("persists the configured limit and rejects invalid settings without replacing it", async () => {
    await store(["settings-set", JSON.stringify({ proposal_item_limit: 1000 })]);
    expect((await store<any>(["settings-get"])).settings.proposal_item_limit).toBe(1000);
    for (const value of [0, -1, 1.5, "", "invalid", null, true, [1], MAX_PROPOSAL_ITEMS + 1]) {
      await expect(store(["settings-set", JSON.stringify({ proposal_item_limit: value })])).rejects.toThrow(
        "whole number",
      );
      expect((await store<any>(["settings-get"])).settings.proposal_item_limit).toBe(1000);
    }
  });

  it("rejects a proposal without an exact source folder", async () => {
    await expect(store(["propose", "archive", JSON.stringify([{ account: "work", uid: "12" }])])).rejects.toThrow(
      "exact source folder",
    );
  });

  it("accepts only a matching active account, folder, and UID", async () => {
    await expect(
      store(["propose", "archive", JSON.stringify([{ account: "work", uid: "12", source_folder: "INBOX" }])]),
    ).rejects.toThrow("not in the local cache");

    await expect(
      store(["propose", "archive", JSON.stringify([{ account: "work", uid: "12", source_folder: "Archive" }])]),
    ).resolves.toMatchObject({ action: "archive", status: "proposed" });
  });
});
