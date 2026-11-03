// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/agent-runtime", () => ({ runAgent: fake.run }));
const dir = mkdtempSync(path.join(tmpdir(), "doot-agent-jobs-"));
process.env.DOOT_DATABASE_PATH = path.join(dir, "cache.sqlite");
const { db } = await import("@/lib/database");
const { enqueueAgentTurn, decideBodyApproval } = await import("@/lib/agent-jobs");
const { kickBackgroundJobs, getBackgroundJob, cancelSavedAgentJobs } = await import("@/lib/background-jobs");
const { getActiveConversationId } = await import("@/lib/app-state");
beforeEach(() => {
  db.exec("DELETE FROM background_jobs; DELETE FROM agent_sessions; DELETE FROM app_state;");
  fake.run.mockReset().mockImplementation(async (input: any) => {
    db.prepare("UPDATE agent_sessions SET status='complete' WHERE id=?").run(input.sessionId);
    return input.sessionId;
  });
});
afterAll(async () => {
  await kickBackgroundJobs();
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(dir, { recursive: true, force: true });
});
it("persists a submitted turn and deduplicates acceptance without a browser", async () => {
  const one = enqueueAgentTurn(
    { text: "Synthetic task", selected: [{ account: "fake", uid: "1", folder: "INBOX" }] },
    "command-1",
  );
  const two = enqueueAgentTurn({ text: "Synthetic task" }, "command-1");
  expect(two.id).toBe(one.id);
  expect(getActiveConversationId()).toBeTruthy();
  await kickBackgroundJobs();
  expect(fake.run).toHaveBeenCalledTimes(1);
  expect(fake.run.mock.calls[0][0].requestId).toBe("command-1");
  expect(getBackgroundJob(one.id).status).toBe("complete");
});
it("persists exact body decisions and queues approved continuation once", async () => {
  const id = "synthetic-session";
  db.prepare("INSERT INTO agent_sessions(id,title,started_at,updated_at) VALUES(?,'Test','now','now')").run(id);
  const request = {
    id: "request-1",
    reason: "Read synthetic body",
    messages: [{ account: "fake", uid: "1", folder: "INBOX", subject: "Synthetic" }],
  };
  db.prepare(
    "INSERT INTO agent_events(session_id,event_type,metadata_json,created_at) VALUES(?,'body_read_requested',?,'now')",
  ).run(id, JSON.stringify({ request }));
  const first = decideBodyApproval(id, request.id, true);
  expect(decideBodyApproval(id, request.id, true)).toEqual(first);
  expect(() => decideBodyApproval(id, request.id, false)).toThrow("saved decision");
  await kickBackgroundJobs();
  expect(fake.run).toHaveBeenCalledTimes(1);
  expect(fake.run.mock.calls[0][0].selected).toEqual([{ account: "fake", uid: "1", folder: "INBOX" }]);
  expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='body_read_decided'").get()).toEqual({
    count: 1,
  });
});
it("persists denial without scheduling body reads", async () => {
  db.prepare(
    "INSERT INTO agent_sessions(id,title,started_at,updated_at) VALUES('synthetic-session','Test','now','now')",
  ).run();
  db.prepare(
    "INSERT INTO agent_events(session_id,event_type,metadata_json,created_at) VALUES('synthetic-session','body_read_requested',?,'now')",
  ).run(JSON.stringify({ request: { id: "request-2", messages: [] } }));
  expect(decideBodyApproval("synthetic-session", "request-2", false)).toEqual({ status: "denied" });
  await kickBackgroundJobs();
  expect(fake.run).not.toHaveBeenCalled();
});

it("cancels a saved turn before it starts, without executing it", async () => {
  const job = enqueueAgentTurn({ text: "Synthetic cancellation" }, "cancel-command");
  expect(cancelSavedAgentJobs(job.source.session_id)).toBe(1);
  await kickBackgroundJobs();
  expect(getBackgroundJob(job.id).status).toBe("cancelled");
  expect(fake.run).not.toHaveBeenCalled();
});
