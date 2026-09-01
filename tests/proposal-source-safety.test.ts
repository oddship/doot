// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
