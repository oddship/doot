// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readApiRoutes } from "./source-contract";

describe("unified activity history", () => {
  it("migrates history entries and persisted schedules", async () => {
    const database = await readFile("lib/database.ts", "utf8");
    expect(database).toContain("history_kind TEXT NOT NULL DEFAULT 'agent'");
    expect(database).toContain("ADD COLUMN history_kind TEXT NOT NULL DEFAULT 'agent'");
    expect(database).toContain("CREATE TABLE IF NOT EXISTS schedules");
    expect(database).toContain("CREATE INDEX IF NOT EXISTS schedules_due");
  });

  it("persists sync jobs and per-account events", async () => {
    const sync = await readFile("lib/sync.ts", "utf8");
    expect(sync).toContain('kind: "job"');
    expect(sync).toContain('event_type: "sync_account_started"');
    expect(sync).toContain('"sync_account_complete"');
    expect(sync).toContain('event_type: "job_complete"');
  });

  it("filters and labels Agent, Sync, Flow, Action, and Schedule entries", async () => {
    const list = await readFile("components/history-screen.tsx", "utf8");
    const detail = await readFile("app/history/[id]/page.tsx", "utf8");
    for (const kind of ["agent", "job", "flow", "action", "schedule"]) expect(list).toContain(`${kind}: { label:`);
    expect(list).toContain("All statuses");
    expect(list).toContain("Filter by title");
    expect(detail).toContain("Account results");
    expect(detail).toContain("Activity summary");
    expect(detail).toContain("HistoryProposalAction");
  });

  it("schedules safe recurring work and preserves the browser mailbox-write boundary", async () => {
    const schedules = await readFile("lib/schedules.ts", "utf8");
    const server = await readFile("server.mjs", "utf8");
    const route = await readApiRoutes();
    expect(server).toContain("setInterval(schedulerTick, 30_000)");
    expect(route).toContain('key === "schedules" && method === "POST"');
    expect(route).toContain('key === "scheduler/tick"');
    expect(schedules).toContain('["rule-propose", String(rule.id)]');
    expect(schedules).toContain('startSync({ trigger: "schedule"');
    expect(schedules).toContain("scheduled_sync_skipped");
    expect(schedules).not.toContain('["apply"');
    expect(route).toContain('confirmedBody(request, "Explicit confirmation is required to create a schedule")');
  });

  it("records configuration, proposal, and IMAP actions without credentials", async () => {
    const route = await readApiRoutes();
    for (const event of [
      "account_connected",
      "folder_${action}",
      "draft_saved_to_imap",
      "flow_proposal_created",
      "proposal_applied",
      "schedule_created",
    ])
      expect(route).toContain(event);
    expect(route).toContain("Credentials are not included in History");
  });
});
