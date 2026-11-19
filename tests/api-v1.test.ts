// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ run: vi.fn(), apply: vi.fn(), read: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/agent-runtime", () => ({
  runAgent: fake.run,
  cancelAgent: vi.fn(),
  listClassifierModels: vi.fn(),
  listModels: vi.fn(),
  resumeInterruptedAgents: vi.fn(),
  updateRuntimeKey: vi.fn(),
}));
vi.mock("@/lib/imap", () => ({
  createMailboxActionSession: () => ({ close: vi.fn(async () => {}) }),
  applyMailboxActions: fake.apply,
  readMessage: fake.read,
  readMessages: fake.read,
  syncAccount: fake.sync,
  appendImapDraft: vi.fn(),
  mutateAccountFolder: vi.fn(),
  closeAccountReadSessions: vi.fn(),
  discoverAccountFolders: vi.fn(),
  testAccount: vi.fn(),
  warmMessageReader: vi.fn(),
}));
const directory = mkdtempSync(path.join(tmpdir(), "doot-api-v1-"));
const previousPath = process.env.DOOT_DATABASE_PATH;
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite");
const { db } = await import("@/lib/database");
const { kickBackgroundJobs } = await import("@/lib/background-jobs");
const { GET } = await import("@/app/api/[...path]/route");
const { recordReviewDecisions, readReviewNext } = await import("@/lib/body-review");

async function api(method: string, endpoint: string, body?: any, headers: Record<string, string> = {}) {
  const url = new URL(`http://127.0.0.1:8765/api/v1${endpoint}`);
  const response = await GET(
    new Request(url, {
      method,
      headers: { host: url.host, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ path: url.pathname.slice(5).split("/") }) },
  );
  return { response, status: response.status, data: await response.json() };
}
function session(id = "synthetic-session") {
  db.prepare(
    "INSERT INTO agent_sessions(id,title,status,started_at,updated_at) VALUES(?,'Synthetic','complete','now','now')",
  ).run(id);
}
function message(uid = "1", folder = "INBOX") {
  db.prepare(
    "INSERT INTO messages(account,account_email,folder,uid,sender,subject,present,fetched_at) VALUES('demo','demo@example.com',?,?,'news@example.com','Synthetic',1,'now')",
  ).run(folder, uid);
}
beforeEach(async () => {
  await kickBackgroundJobs();
  db.exec(
    "DELETE FROM background_jobs; DELETE FROM agent_sessions; DELETE FROM agent_events; DELETE FROM app_state; DELETE FROM actions; DELETE FROM messages; DELETE FROM sync_state; DELETE FROM agent_artifacts; DELETE FROM email_accounts;",
  );
  fake.run.mockReset().mockImplementation(async (input: any) => {
    db.prepare("UPDATE agent_sessions SET status='complete' WHERE id=?").run(input.sessionId);
    return input.sessionId;
  });
  fake.apply.mockReset().mockImplementation(async (actions: string[], items: any[]) => ({
    status: "applied",
    actions,
    results: items.map((item) => ({ ...item, ok: true })),
    errors: [],
  }));
  fake.read.mockReset();
  fake.sync.mockReset().mockResolvedValue({ synced: 0 });
});
afterAll(async () => {
  await kickBackgroundJobs();
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  if (previousPath === undefined) delete process.env.DOOT_DATABASE_PATH;
  else process.env.DOOT_DATABASE_PATH = previousPath;
  rmSync(directory, { recursive: true, force: true });
});

describe("versioned API boundaries", () => {
  it("discovers public operations and generates a consistent OpenAPI contract", async () => {
    const index = await api("GET", "");
    expect(index.status).toBe(200);
    expect(index.response.headers.get("x-doot-api-version")).toBe("1");
    expect(index.response.headers.get("cache-control")).toBe("no-store");
    const { data: spec } = await api("GET", "/openapi.json");
    expect(spec.openapi).toBe("3.1.0");
    expect(
      spec.paths["/api/v1/proposals/{id}/approve"].post.requestBody.content["application/json"].schema.properties
        .confirm.const,
    ).toBe(true);
    expect(spec.paths["/api/v1/messages"].get.parameters.find((item: any) => item.name === "folder")).toMatchObject({
      required: false,
      schema: { default: "INBOX" },
    });
    expect(index.data.operations).toHaveLength(
      Object.values(spec.paths).flatMap((item: any) => Object.keys(item)).length,
    );
    const ids = Object.values(spec.paths).flatMap((item: any) =>
      Object.values(item).map((method: any) => method.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(spec)).not.toContain("background/recover");
    expect(JSON.stringify(spec)).not.toContain("scheduler/tick");
  });
  it("rejects foreign origins, hidden internal routes, suffix aliases and invalid methods", async () => {
    expect((await api("POST", "/sync", undefined, { origin: "https://foreign.example" })).status).toBe(403);
    expect(fake.sync).not.toHaveBeenCalled();
    expect((await api("POST", "/agent/recover")).status).toBe(404);
    expect((await api("DELETE", "/rules/1/not-a-delete-route", { confirm: true })).status).toBe(404);
    const wrong = await api("DELETE", "/jobs/fake", { confirm: true });
    expect(wrong.status).toBe(405);
    expect(wrong.response.headers.get("allow")).toBe("GET");
    expect((await api("GET", "/artifacts/9999999999999999999999999")).status).toBe(400);
  });
  it("validates JSON media type, explicit confirmation and query bounds before effects", async () => {
    expect((await api("POST", "/proposals/1/approve", {})).status).toBe(400);
    expect((await api("POST", "/proposals/1/approve", { confirm: "true" })).status).toBe(400);
    expect((await api("POST", "/proposals/1/approve", { confirm: true, extra: true })).status).toBe(400);
    expect(
      (await api("POST", "/proposals/1/approve", { confirm: true }, { "content-type": "text/plain" })).status,
    ).toBe(415);
    expect((await api("GET", "/proposals?limit=0")).status).toBe(400);
    expect((await api("GET", "/proposals?after=-1")).status).toBe(400);
    expect((await api("GET", "/proposals?limit=10&limit=20")).status).toBe(400);
    expect(fake.apply).not.toHaveBeenCalled();
    const item = { account: "demo", source_folder: "INBOX", uid: "1" };
    expect((await api("POST", "/proposals", { action: "delete", items: [item, item] })).status).toBe(400);
    expect(db.prepare("SELECT count(*) count FROM actions").get()).toEqual({ count: 0 });
  });
});

describe("browser-free workflow", () => {
  it("submits durable chat, polls it and deduplicates only identical command inputs", async () => {
    const input = { commandId: "synthetic-turn", text: "Review synthetic newsletters", selected: [] };
    const first = await api("POST", "/agent/turns", input);
    const repeated = await api("POST", "/agent/turns", input);
    expect(first.status).toBe(202);
    expect(repeated.data.job.id).toBe(first.data.job.id);
    expect(first.data.links.events).toContain(first.data.session_id);
    expect((await api("POST", "/agent/turns", { ...input, text: "Different task" })).status).toBe(409);
    await kickBackgroundJobs();
    expect(fake.run).toHaveBeenCalledTimes(1);
    const done = await api("GET", `/jobs/${first.data.job.id}`);
    expect(done.data.job).toMatchObject({ status: "complete", completed: 1, total: 1 });
    expect((await api("GET", `/agent/sessions/${first.data.session_id}/events`)).status).toBe(200);
    expect(fake.apply).not.toHaveBeenCalled();
  });
  it("pages events without omissions, including an empty poll cursor", async () => {
    session();
    const insert = db.prepare(
      "INSERT INTO agent_events(session_id,event_type,content,created_at) VALUES('synthetic-session','assistant_message',?,'now')",
    );
    const ids = [1, 2, 3].map((n) => Number(insert.run(`Synthetic ${n}`).lastInsertRowid));
    const first = await api("GET", "/agent/sessions/synthetic-session/events?limit=2");
    expect(first.data.events.map((event: any) => event.id)).toEqual(ids.slice(0, 2));
    expect(first.data.has_more).toBe(true);
    const second = await api("GET", `/agent/sessions/synthetic-session/events?after=${first.data.next_after}&limit=2`);
    expect(second.data.events.map((event: any) => event.id)).toEqual(ids.slice(2));
    expect(second.data.has_more).toBe(false);
    const empty = await api("GET", `/agent/sessions/synthetic-session/events?after=${second.data.next_after}`);
    expect(empty.data).toMatchObject({ events: [], next_after: ids[2], has_more: false });
  });
  it("reads exact saved notes, pages metadata and defaults header searches to INBOX", async () => {
    const content = { messages: [{ account: "demo", folder: "INBOX", uid: "1" }], evidence: "Synthetic content" };
    const created = await api("POST", "/artifacts", { kind: "note", title: "Synthetic scope", content });
    expect(created.status).toBe(201);
    expect((await api("GET", `/artifacts/${created.data.artifact.id}`)).data.artifact.content).toEqual(content);
    const listing = await api("GET", "/artifacts?title=Synthetic&limit=1");
    expect(listing.data.artifacts).toHaveLength(1);
    expect(listing.data.artifacts[0]).not.toHaveProperty("content");
    message("1");
    message("2", "Archive");
    db.prepare(
      "INSERT INTO sync_state(account,folder,mailbox_messages) VALUES('demo','INBOX',1),('demo','Archive',8)",
    ).run();
    const inbox = await api("GET", "/messages?account=demo");
    expect(inbox.data.total).toBe(1);
    expect(inbox.data.scope).toMatchObject({ folder: "INBOX", source: "folder-cache" });
    expect(inbox.data.mailbox.messages).toBe(1);
    expect((await api("GET", "/messages?account=demo&folder=Archive")).data.messages[0].uid).toBe("2");
    message("3");
    message("4", "Archive");
    db.prepare("UPDATE messages SET provider_id='synthetic-shared-provider-id' WHERE uid IN ('3','4')").run();
    const archive = await api("GET", "/messages?account=demo&folder=Archive");
    expect(archive.data.messages.map((row: any) => row.uid)).toEqual(expect.arrayContaining(["2", "4"]));
    expect(archive.data.total).toBe(2);
    expect((await api("GET", "/artifacts/99999")).status).toBe(404);
    expect(fake.read).not.toHaveBeenCalled();
    expect((await api("GET", "/accounts/no-such-account")).status).toBe(404);
    expect((await api("GET", "/rules/999999")).status).toBe(404);
  });
  it("keeps exact body approval separate from mailbox approval and review state session-scoped", async () => {
    session();
    session("another-session");
    const messages = [{ account: "demo", folder: "INBOX", uid: "1" }];
    db.prepare(
      "INSERT INTO agent_events(session_id,event_type,metadata_json,created_at) VALUES('synthetic-session','body_read_requested',?,'now')",
    ).run(JSON.stringify({ request: { id: "body-request", reason: "Synthetic body review", messages } }));
    const requests = await api("GET", "/agent/sessions/synthetic-session/body-approvals");
    expect(requests.data.approvals[0]).toMatchObject({ request: { messages }, decision: { status: "pending" } });
    const path = "/agent/sessions/synthetic-session/body-approvals/body-request";
    expect((await api("POST", path, {})).status).toBe(400);
    const one = await api("POST", path, { approved: true });
    const two = await api("POST", path, { approved: true });
    expect(two.data.job_id).toBe(one.data.job_id);
    expect((await api("POST", path, { approved: false })).status).toBe(409);
    await kickBackgroundJobs();
    const review = await api("GET", "/agent/sessions/synthetic-session/reviews/body-request");
    expect(review.data).toMatchObject({ total: 1, bodies_read: 0, decided: 0 });
    expect((await api("GET", "/agent/sessions/another-session/reviews/body-request")).status).toBe(404);
    await readReviewNext("synthetic-session", "body-request", "synthetic-read", async (refs) => ({
      messages: refs.map((ref) => ({ ...ref, body_text: "Synthetic optional newsletter" })),
    }));
    recordReviewDecisions("synthetic-session", "body-request", [
      { ...messages[0], disposition: "delete", reason: "Synthetic optional content" },
    ]);
    expect((await api("GET", "/agent/sessions/synthetic-session/reviews")).data.reviews[0]).toMatchObject({
      decided: 1,
      dispositions: { delete: 1 },
    });
    expect(db.prepare("SELECT count(*) count FROM actions").get()).toEqual({ count: 0 });
    expect(fake.read).not.toHaveBeenCalled();
    expect(fake.apply).not.toHaveBeenCalled();
  });
  it("creates an exact proposal, confirms it once, and labels cached verification honestly", async () => {
    message();
    message("2");
    db.prepare(
      "INSERT INTO sync_state(account,folder,last_sync,uid_validity) VALUES('demo','INBOX','synthetic-sync','7')",
    ).run();
    const prepared = await api("POST", "/proposals", {
      action: "delete",
      actions: ["delete"],
      reason: "Synthetic reviewed scope",
      items: [{ account: "demo", source_folder: "INBOX", uid: "1" }],
    });
    expect(prepared.status).toBe(201);
    expect(fake.apply).not.toHaveBeenCalled();
    const id = prepared.data.id;
    const accepted = await api("POST", `/proposals/${id}/approve`, { confirm: true });
    const again = await api("POST", `/proposals/${id}/approve`, { confirm: true });
    expect(accepted.status).toBe(202);
    expect(again.data.job.id).toBe(accepted.data.job.id);
    await kickBackgroundJobs();
    expect(fake.apply).toHaveBeenCalledTimes(1);
    expect(fake.apply.mock.calls[0][1]).toMatchObject([
      { account: "demo", source_folder: "INBOX", uid: "1", uid_validity: "7" },
    ]);
    const verification = await api("GET", `/proposals/${id}/verification`);
    expect(verification.data).toMatchObject({
      total: 1,
      counts: { present: 1, absent: 0, unknown: 0 },
      job: { status: "complete" },
      evidence: { live_mailbox_checked: false, trash_verified: false, unread_state_verified: false },
    });
    db.prepare("UPDATE messages SET present=0 WHERE uid='1'").run();
    expect((await api("GET", `/proposals/${id}/verification`)).data.counts.absent).toBe(1);
    db.prepare("UPDATE sync_state SET uid_validity='8'").run();
    expect((await api("GET", `/proposals/${id}/verification`)).data.counts.unknown).toBe(1);
    expect((await api("GET", "/proposals?limit=1")).data.proposals[0].id).toBe(id);
    expect(db.prepare("SELECT present FROM messages WHERE uid='2'").get()).toEqual({ present: 1 });
  });
});
