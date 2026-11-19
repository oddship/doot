// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { readOnlyCodemodeExtension } from "@/lib/agent-codemode";

const { store } = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("@/lib/store", () => ({ store, emitBackground: vi.fn() }));
vi.mock("@/lib/agent-credential-store", () => ({ sqliteAgentCredentialStore: {} }));
const directory = mkdtempSync(path.join(tmpdir(), "doot-managed-tools-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite");
const { db } = await import("@/lib/database");
const { createApprovedBodyReview } = await import("@/lib/body-review");
const { toolsFor } = await import("@/lib/agent-runtime");
beforeEach(() => {
  db.exec("DELETE FROM app_state; DELETE FROM agent_events; DELETE FROM agent_sessions;");
  db.prepare(
    "INSERT INTO agent_sessions(id,title,started_at,updated_at) VALUES('test-session','Synthetic','now','now')",
  ).run();
  const messages = Array.from({ length: 157 }, (_, index) => ({
    account: "fake",
    folder: "INBOX",
    uid: String(index + 1),
  }));
  db.prepare(
    "INSERT INTO agent_events(session_id,event_type,metadata_json,created_at) VALUES('test-session','body_read_requested',?,'now')",
  ).run(JSON.stringify({ request: { id: "snapshot", messages } }));
  db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(
    "body-decision:test-session:snapshot",
    JSON.stringify({ status: "approved" }),
  );
  createApprovedBodyReview("test-session", "snapshot");
  store
    .mockReset()
    .mockImplementation(async (args: string[]) =>
      args[0] === "read-batch"
        ? { messages: JSON.parse(args[1]).map((ref: any) => ({ ...ref, body_text: "Synthetic newsletter" })) }
        : {},
    );
});
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(directory, { recursive: true, force: true });
});
const state = () =>
  ({ id: "test-session", selected: [{ account: "not-approved", folder: "INBOX", uid: "999" }], sink: vi.fn() }) as any;

it("uses the saved scope across turns instead of an unrelated current selection", async () => {
  const current = state();
  const first = await toolsFor(current)
    .find((tool) => tool.name === "email_review_next")
    .execute("first", {});
  expect(first.details.progress).toMatchObject({ total: 157, bodies_read: 5 });
  expect(first.details.messages.map((message: any) => message.uid)).toEqual(["1", "2", "3", "4", "5"]);
  expect(current.sink).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "data-review-progress",
      data: expect.objectContaining({ total: 157, bodies_read: 5 }),
    }),
  );
  const next = await toolsFor(state())
    .find((tool) => tool.name === "email_review_next")
    .execute("next-turn", {});
  expect(next.details.messages[0].uid).toBe("6");
  const decisions = await toolsFor(current)
    .find((tool) => tool.name === "email_review_record")
    .execute("decide", {
      decisions: [{ account: "fake", folder: "INBOX", uid: "1", disposition: "delete", reason: "Synthetic offer" }],
    });
  expect(decisions.details).toMatchObject({ decided: 1, dispositions: { delete: 1 } });
  expect(store.mock.calls.some(([args]) => ["propose", "apply", "read"].includes(args[0]))).toBe(false);
  expect(db.prepare("SELECT count(*) count FROM actions").get()).toEqual({ count: 0 });
});

it("exposes plain typed results in the actual codemode sandbox", async () => {
  const nested = toolsFor(state());
  let script: any;
  await readOnlyCodemodeExtension({
    registerTool: (tool: any) => {
      script = tool;
    },
    getAllTools: () => nested,
    appendEntry: vi.fn(),
  } as any);
  const result = await script.execute(
    "script",
    {
      code: 'const r = await tools.email_review_next({review_id:"snapshot"}); return {count:r.messages.length,total:r.progress.total,more:r.messages[0].body_has_more};',
    },
    new AbortController().signal,
    undefined,
    {
      tools: nested,
      sessionManager: { getBranch: () => [] },
      executeTool: async (name: string, args: any) => ({
        toolCall: { id: "script/read", name, arguments: args },
        result: await nested.find((tool) => tool.name === name).execute("script/read", args),
        isError: false,
      }),
    },
  );
  const text = result.content
    .filter((part: any) => part.type === "text")
    .map((part: any) => part.text)
    .join("\n");
  expect(text).toContain('"total":157');
  expect(text).toContain('"count":5');
  expect(text).toContain('"more":false');
});

it("rejects another conversation before its reader runs", async () => {
  const other = { ...state(), id: "other-session" };
  await expect(
    toolsFor(other)
      .find((tool) => tool.name === "email_review_next")
      .execute("denied", { review_id: "snapshot" }),
  ).rejects.toThrow("approval");
  expect(store).not.toHaveBeenCalled();
});
