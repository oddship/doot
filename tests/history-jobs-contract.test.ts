// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("history jobs", () => {
  it("migrates history entries with an Agent default", async () => {
    const database = await readFile("lib/database.ts", "utf8");
    expect(database).toContain("history_kind TEXT NOT NULL DEFAULT 'agent'");
    expect(database).toContain("ADD COLUMN history_kind TEXT NOT NULL DEFAULT 'agent'");
  });

  it("persists sync jobs and per-account events", async () => {
    const sync = await readFile("lib/sync.ts", "utf8");
    expect(sync).toContain('kind: "job"');
    expect(sync).toContain('event_type: "sync_account_started"');
    expect(sync).toContain('"sync_account_complete"');
    expect(sync).toContain('event_type: "job_complete"');
  });

  it("labels history entries as Job or Doot", async () => {
    const list = await readFile("components/history-screen.tsx", "utf8");
    const detail = await readFile("app/history/[id]/page.tsx", "utf8");
    expect(list).toContain('session.history_kind === "job" ? "Job" : "Doot"');
    expect(detail).toContain('isJob ? "Job" : "Doot"');
    expect(detail).toContain("Account results");
  });
});
