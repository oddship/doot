// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ apply: vi.fn(), append: vi.fn(), folder: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/store", () => ({ store: fake.store, emitBackground: vi.fn() }));
vi.mock("@/lib/imap", () => ({
  applyMailboxActions: fake.apply,
  appendImapDraft: fake.append,
  mutateAccountFolder: fake.folder,
}));
const directory = mkdtempSync(path.join(tmpdir(), "doot-jobs-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "db.sqlite");
const { getSyncJob, startConfiguredSync } = await import("@/lib/sync");
const { runDueSchedules, executeScheduleOccurrence } = await import("@/lib/schedules");
const { db } = await import("@/lib/database");
const {
  approveDraftUpload,
  approveFolderMutation,
  approveProposal,
  kickBackgroundJobs,
  recoverBackgroundJobs,
  getBackgroundJob,
  enqueueBackgroundJob,
} = await import("@/lib/background-jobs");
beforeEach(() => {
  fake.store.mockReset().mockResolvedValue({ accounts: [], errors: [] });
  fake.folder.mockReset();
  fake.append.mockReset();
  fake.apply.mockReset().mockResolvedValue({ status: "applied", results: [{ ok: true }], errors: [] });
  db.exec(
    "DELETE FROM background_jobs; DELETE FROM actions; DELETE FROM agent_sessions; DELETE FROM sync_state; DELETE FROM schedules; DELETE FROM email_rules; DELETE FROM app_state; DELETE FROM messages;",
  );
  db.prepare("INSERT INTO sync_state(account,folder,uid_validity) VALUES('fake','INBOX','7')").run();
});
afterAll(async () => {
  await kickBackgroundJobs();
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});
function proposal() {
  return Number(
    db
      .prepare("INSERT INTO actions(action,items_json,actions_json,created_at) VALUES('archive',?,?,'now')")
      .run(
        JSON.stringify([{ account: "fake", source_folder: "INBOX", uid: "1", uid_validity: "7" }]),
        JSON.stringify(["mark_read", "archive"]),
      ).lastInsertRowid,
  );
}
describe("app-owned approved mailbox jobs", () => {
  it("atomically queues a schedule occurrence and cannot duplicate its proposal after restart", async () => {
    const ruleId = Number(
      db
        .prepare(
          "INSERT INTO email_rules(name,query,action,status,enabled,created_at,updated_at) VALUES('Test','puzzle','archive','active',1,'now','now')",
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      "INSERT INTO messages(account,account_email,folder,uid,subject,fetched_at) VALUES('fake','fake@example.test','INBOX','1','Puzzle notice','now')",
    ).run();
    db.prepare(
      "INSERT INTO schedules(kind,rule_id,frequency,next_run_at,created_at,updated_at) VALUES('flow',?,'once','2020-01-01T00:00:00Z','now','now')",
    ).run(ruleId);
    const first = runDueSchedules();
    expect(first.due).toBe(1);
    expect(runDueSchedules().due).toBe(0);
    await kickBackgroundJobs();
    const job = getBackgroundJob(first.results[0].job_id);
    expect(job.error).toBeNull();
    expect(job.status).toBe("complete");
    expect(db.prepare("SELECT COUNT(*) count FROM actions").get()).toEqual({ count: 1 });
    const schedule = (db.prepare("SELECT payload_json FROM background_jobs WHERE id=?").get(job.id) as any)
      .payload_json;
    executeScheduleOccurrence(JSON.parse(schedule).schedule);
    expect(db.prepare("SELECT COUNT(*) count FROM actions").get()).toEqual({ count: 1 });
    expect(fake.apply).not.toHaveBeenCalled();
  });

  it("resumes incomplete safe sync accounts and restores their persisted status", async () => {
    const steps = [1, 2].map((n) => ({
      account: { name: `fake${n}`, email: `fake${n}@example.test` },
      settings: { sync_days: 30, initial_sync_limit: 75 },
    }));
    const job = enqueueBackgroundJob("sync", "sync:test", {}, steps, "Test sync");
    db.prepare("UPDATE background_jobs SET status='running',owner='old-process' WHERE id=?").run(job.id);
    db.prepare("UPDATE background_steps SET status='complete',result_json='{}' WHERE job_id=? AND position=0").run(
      job.id,
    );
    db.prepare("UPDATE background_steps SET status='running' WHERE job_id=? AND position=1").run(job.id);
    expect(getSyncJob().accounts.map((account) => account.status)).toEqual(["done", "syncing"]);
    recoverBackgroundJobs();
    await kickBackgroundJobs();
    expect(fake.store).toHaveBeenCalledTimes(1);
    expect(getSyncJob()).toMatchObject({ id: job.id, status: "done" });
    expect(getSyncJob().accounts.map((account) => account.status)).toEqual(["done", "done"]);
  });

  it("starts configured sync once per app boot without a browser", async () => {
    process.env.DOOT_INSTANCE_ID = "synthetic-boot";
    db.prepare("UPDATE settings SET value_json='true' WHERE key='sync_on_start'").run();
    try {
      await startConfiguredSync();
      await kickBackgroundJobs();
      await startConfiguredSync();
      await kickBackgroundJobs();
      expect(db.prepare("SELECT COUNT(*) count FROM background_jobs WHERE kind='sync'").get()).toEqual({ count: 1 });
    } finally {
      delete process.env.DOOT_INSTANCE_ID;
      db.prepare("UPDATE settings SET value_json='false' WHERE key='sync_on_start'").run();
    }
  });

  it("queues folder removal once and persists affected Flow reconciliation", async () => {
    fake.folder.mockResolvedValue({ folders: [{ delimiter: "/" }], operation: { action: "delete", path: "Receipts" } });
    db.prepare(
      "INSERT INTO email_rules(name,account,query,action,target_folder,status,enabled,created_at,updated_at) VALUES('Receipts','fake','receipt','move','Receipts','active',1,'now','now')",
    ).run();
    const job = approveFolderMutation("fake", { action: "delete", path: "Receipts" }, "review-1");
    expect(approveFolderMutation("fake", { action: "delete", path: "Receipts" }, "review-1").id).toBe(job.id);
    await kickBackgroundJobs();
    expect(fake.folder).toHaveBeenCalledTimes(1);
    expect(getBackgroundJob(job.id).status).toBe("complete");
    expect(db.prepare("SELECT enabled,status FROM email_rules WHERE name='Receipts'").get()).toEqual({
      enabled: 0,
      status: "paused",
    });
  });

  it("uploads an approved draft snapshot once and preserves later local edits", async () => {
    let release!: (value: any) => void;
    fake.append.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const content = { account: "fake", to: ["recipient@example.test"], subject: "Approved", body: "Text" };
    const id = Number(
      db
        .prepare(
          "INSERT INTO agent_artifacts(kind,title,content_json,status,created_at) VALUES('draft','Approved',?,'draft','now')",
        )
        .run(JSON.stringify(content)).lastInsertRowid,
    );
    const first = approveDraftUpload({ id, title: "Approved", content });
    expect(approveDraftUpload({ id, title: "Approved", content }).id).toBe(first.id);
    await vi.waitFor(() => expect(fake.append).toHaveBeenCalledTimes(1));
    db.prepare("UPDATE agent_artifacts SET content_json=? WHERE id=?").run(
      JSON.stringify({ ...content, body: "Later edit" }),
      id,
    );
    release({ folder: "Drafts", uid: "12" });
    await kickBackgroundJobs();
    expect(getBackgroundJob(first.id).status).toBe("complete");
    expect(db.prepare("SELECT status FROM agent_artifacts WHERE id=?").get(id)).toEqual({ status: "draft" });
    recoverBackgroundJobs();
    await kickBackgroundJobs();
    expect(fake.append).toHaveBeenCalledTimes(1);
  });

  it("atomically admits duplicate approvals once and finishes without a browser", async () => {
    const id = proposal();
    const first = approveProposal(id);
    const duplicate = approveProposal(id);
    expect(first.status).toBe("queued");
    expect(duplicate.id).toBe(first.id);
    await kickBackgroundJobs();
    expect(fake.apply.mock.calls.map((call) => call[0])).toEqual([["mark_read"], ["archive"]]);
    expect(fake.apply.mock.calls[0][1][0].uid_validity).toBe("7");
    expect(getBackgroundJob(first.id)).toMatchObject({ status: "complete", completed: 2, total: 2 });
    expect(db.prepare("SELECT status FROM actions WHERE id=?").get(id)).toEqual({ status: "applied" });
    recoverBackgroundJobs();
    await kickBackgroundJobs();
    expect(fake.apply).toHaveBeenCalledTimes(2);
  });
  it("persists partial receipts and stops when an external write is unconfirmed", async () => {
    fake.apply
      .mockResolvedValueOnce({ status: "applied", results: [], errors: [] })
      .mockResolvedValueOnce({ status: "partial_failure", errors: [{ error: "Connection lost" }] });
    const job = approveProposal(proposal());
    await kickBackgroundJobs();
    expect(getBackgroundJob(job.id)).toMatchObject({ status: "needs_review", completed: 1 });
    recoverBackgroundJobs();
    await kickBackgroundJobs();
    expect(fake.apply).toHaveBeenCalledTimes(2);
  });
  it("recovers queued work and never replays a claimed write after restart", async () => {
    const job = enqueueBackgroundJob(
      "mailbox",
      "test",
      { proposal_id: proposal() },
      [{ action: "archive", item: { account: "fake", uid: "1", source_folder: "INBOX" } }],
      "Test",
    );
    db.prepare("UPDATE background_jobs SET status='running',owner='previous-process' WHERE id=?").run(job.id);
    db.prepare("UPDATE background_steps SET status='running' WHERE job_id=?").run(job.id);
    recoverBackgroundJobs();
    await kickBackgroundJobs();
    expect(getBackgroundJob(job.id).status).toBe("needs_review");
    expect(fake.apply).not.toHaveBeenCalled();
  });
  it("resumes only remaining unclaimed steps after a restart", async () => {
    const job = enqueueBackgroundJob(
      "mailbox",
      "test",
      { proposal_id: proposal() },
      [
        { action: "mark_read", item: {} },
        { action: "archive", item: {} },
      ],
      "Test",
    );
    db.prepare("UPDATE background_jobs SET status='running',owner='previous-process' WHERE id=?").run(job.id);
    db.prepare("UPDATE background_steps SET status='complete',result_json='{}' WHERE job_id=? AND position=0").run(
      job.id,
    );
    recoverBackgroundJobs();
    await kickBackgroundJobs();
    expect(getBackgroundJob(job.id).status).toBe("complete");
    expect(fake.apply).toHaveBeenCalledTimes(1);
    expect(fake.apply.mock.calls[0][0]).toEqual(["archive"]);
  });
});

it("finishes accepted writes even when a disconnected view notification fails", async () => {
  const previous = (globalThis as any).__emailAgentBroadcast;
  (globalThis as any).__emailAgentBroadcast = () => {
    throw new Error("Disconnected view");
  };
  try {
    const job = approveProposal(proposal());
    await kickBackgroundJobs();
    expect(getBackgroundJob(job.id).status).toBe("complete");
  } finally {
    (globalThis as any).__emailAgentBroadcast = previous;
  }
});
