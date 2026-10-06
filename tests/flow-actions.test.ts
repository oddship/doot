// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mailActionLabel, normalizeMailActions, ruleActionFingerprint } from "@/lib/mail-actions";

const { apply } = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/imap", () => ({ applyMailboxActions: apply }));
const directory = mkdtempSync(path.join(tmpdir(), "doot-flow-actions-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite3");
const { db } = await import("@/lib/database");
const { saveRule, getRule } = await import("@/lib/rules");
const { store } = await import("@/lib/store");
const { handleFlowRoutes } = await import("@/lib/api/flow-routes");
db.prepare(
  "INSERT INTO email_accounts(name,host,username,password,created_at,updated_at) VALUES('work','imap.example.test','work@example.test','dummy','now','now')",
).run();
db.prepare(
  "INSERT INTO imap_folders(account,path,name,discovered_at) VALUES('work','Transactions','Transactions','now')",
).run();
const input = {
  name: "Bank alerts",
  account: "work",
  query: "subject:puzzle",
  actions: ["mark_read", "move"],
  target_folder: "Transactions",
};
beforeEach(() => {
  vi.clearAllMocks();
  apply.mockResolvedValue({ status: "applied", results: [], errors: [] });
  db.exec("DELETE FROM actions;DELETE FROM email_rules;DELETE FROM messages;");
  db.prepare(
    "INSERT INTO messages(account,account_email,folder,uid,subject,fetched_at) VALUES('work','work@example.test','INBOX','1','Puzzle alert','now')",
  ).run();
});
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});
describe("reviewable multi-action Flows", () => {
  it("preserves legacy single-action definitions and persists complete new plans", () => {
    const legacy = db
      .prepare(
        "INSERT INTO email_rules(name,query,action,created_at,updated_at) VALUES('Old','puzzle','archive','now','now')",
      )
      .run();
    expect(getRule(Number(legacy.lastInsertRowid)).actions).toEqual(["archive"]);
    const saved = saveRule(input);
    expect(saved).toMatchObject({
      action: "move",
      actions: ["mark_read", "move"],
      target_folder: "Transactions",
      enabled: false,
    });
    expect(saveRule({ id: saved.id, name: "Updated" }).actions).toEqual(["mark_read", "move"]);
    expect(saveRule({ id: saved.id, action: "mark_read" })).toMatchObject({
      actions: ["mark_read"],
      target_folder: null,
    });
  });
  it("rejects unsupported orderings and still validates move destinations", () => {
    for (const actions of [
      [],
      ["move", "mark_read"],
      ["move", "delete"],
      ["mark_read", "mark_read"],
      ["unknown"],
      ["mark_read", "move", "delete"],
    ])
      expect(() => normalizeMailActions(actions)).toThrow();
    expect(() => saveRule({ ...input, actions: null })).toThrow();
    expect(() => saveRule({ ...input, target_folder: "Missing" })).toThrow("discovered");
    expect(mailActionLabel({ action: "move", actions: ["mark_read", "move"], target_folder: "Transactions" })).toBe(
      "Mark as read → Move to Transactions",
    );
  });
  it("snapshots the whole plan in a proposal, unaffected by subsequent Flow edits", async () => {
    const rule = saveRule(input);
    const result = await store<any>(["rule-propose", String(rule.id)]);
    expect(result.proposal.actions).toEqual(["mark_read", "move"]);
    saveRule({ id: rule.id, action: "archive" });
    expect((await store<any>(["action-get", String(result.proposal.id)])).actions).toEqual(["mark_read", "move"]);
    expect((await store<any>(["dashboard"])).actions[0].actions).toEqual(["mark_read", "move"]);
    await store(["apply", String(result.proposal.id)]);
    expect(apply).toHaveBeenCalledWith(
      ["mark_read", "move"],
      [{ account: "work", uid: "1", source_folder: "INBOX", folder: "Transactions" }],
    );
  });
  it("rejects a stale confirmation when the reviewed action sequence changes", async () => {
    const rule = saveRule(input);
    const expected = ruleActionFingerprint(rule);
    saveRule({ id: rule.id, action: "archive" });
    await expect(store(["rule-propose", String(rule.id), "--expected", expected])).rejects.toThrow(
      "changed since review",
    );
    expect(apply).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) count FROM actions").get()).toEqual({ count: 0 });
  });
  it("requires browser confirmation of the full reviewed definition before a run", async () => {
    const rule = saveRule(input);
    const route = (body: any) =>
      handleFlowRoutes({
        request: new Request(`http://localhost/api/rules/${rule.id}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        path: ["rules", String(rule.id), "run"],
        key: `rules/${rule.id}/run`,
        method: "POST",
        url: new URL("http://localhost"),
      });
    await expect(route({ confirm: true })).rejects.toThrow("complete Flow action sequence");
    expect(apply).not.toHaveBeenCalled();
    const response = await route({ confirm: true, expected_rule: ruleActionFingerprint(rule) });
    expect(response?.status).toBe(200);
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
