// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";

const { runtime } = vi.hoisted(() => ({ runtime: { current: undefined as any } }));
vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...(await original<any>()),
  ModelRuntime: { create: async () => runtime.current },
}));

it("continues conversations and preserves completed workflow state when a command is retried", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "doot-runtime-transition-"));
  process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  runtime.current = models;
  const { db } = await import("@/lib/database");
  const { runAgent, closeAgentRuntime } = await import("@/lib/agent-runtime");
  try {
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("memory_set", { namespace: "preferences", key: "test", value: "local-only" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Preference saved.")]),
    ]);
    const first: any[] = [];
    const id = await runAgent({ text: "Remember my test preference" }, (event) => first.push(event));
    expect(
      first
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Preference saved.");
    expect(db.prepare("SELECT COUNT(*) count FROM agent_memory").get()).toEqual({ count: 1 });
    await closeAgentRuntime();
    faux.setResponses([fauxAssistantMessage([fauxText("Continuing the same conversation.")])]);
    const second: any[] = [];
    expect(await runAgent({ sessionId: id, text: "Continue" }, (event) => second.push(event))).toBe(id);
    expect(
      second
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Continuing the same conversation.");
    expect(db.prepare("SELECT COUNT(*) count FROM agent_sessions").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='assistant_message'").get()).toEqual({
      count: 2,
    });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='tool_end'").get()).toEqual({
      count: 1,
    });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='tool_start'").get()).toEqual({
      count: 1,
    });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("render_workspace", {
            schemaVersion: 1,
            title: "Synthetic review",
            summary: "Review the suggested Flow",
            root: {
              type: "action_group",
              actions: [{ label: "Review Flow", intent: { type: "open_flow", flowId: 1 } }],
            },
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Review the saved Flow.")]),
    ]);
    const command = { text: "Suggest a flow for my inbox", requestId: "workflow-recovery-command" };
    const workflowId = await runAgent(command, () => {});
    expect(db.prepare("SELECT status FROM agent_sessions WHERE id=?").get(workflowId)).toEqual({ status: "complete" });
    await closeAgentRuntime();
    await runAgent({ ...command, sessionId: workflowId }, () => {});
    expect(db.prepare("SELECT status FROM agent_sessions WHERE id=?").get(workflowId)).toEqual({ status: "complete" });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_views WHERE session_id=?").get(workflowId)).toEqual({
      count: 1,
    });
  } finally {
    await closeAgentRuntime();
    db.close();
    delete (globalThis as any).__emailAgentDatabase;
    delete process.env.DOOT_DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
