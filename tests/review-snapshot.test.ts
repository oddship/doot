// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "doot-review-snapshot-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite");
const { db } = await import("@/lib/database");
const { store } = await import("@/lib/store");
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});
it("snapshots more than a normal search page without fetching message bodies", async () => {
  db.transaction(() => {
    const insert = db.prepare(
      "INSERT INTO messages(account,account_email,uid,folder,sender,subject,present,fetched_at) VALUES('fake','fake@example.com',?,'INBOX','news@example.com','Synthetic newsletter',1,'now')",
    );
    for (let index = 1; index <= 157; index++) insert.run(String(index));
  })();
  const normal = await store<any>([
    "search",
    "--account",
    "fake",
    "--query",
    "from:news@example.com",
    "--limit",
    "1000",
  ]);
  expect(normal.messages).toHaveLength(100);
  const snapshot = await store<any>([
    "body-snapshot",
    "--account",
    "fake",
    "--query",
    "from:news@example.com",
    "--limit",
    "1000",
  ]);
  expect(snapshot.total).toBe(157);
  expect(snapshot.messages).toHaveLength(157);
  expect(new Set(snapshot.messages.map((message: any) => message.uid)).size).toBe(157);
  expect(db.prepare("SELECT sum(body_fetched) fetched FROM messages").get()).toEqual({ fetched: 0 });
});
