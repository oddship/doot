import { describe, expect, it } from "vitest";
import { applyConversationToolEvent, replayLastTurn } from "@/lib/client-conversation";

const event = (event_type: string, content: string, metadata = {}) => ({ event_type, content, metadata });

describe("conversation history replay", () => {
  it("retains early live results when a delayed or duplicate start arrives", () => {
    const result = applyConversationToolEvent([], {
      type: "tool-output-available",
      toolCallId: "late",
      toolName: "render_workspace",
      isError: true,
      summary: "Invalid dashboard",
    });
    const start = {
      type: "tool-input-start",
      toolCallId: "late",
      toolName: "render_workspace",
      inputSummary: "Working",
    };
    expect(applyConversationToolEvent(applyConversationToolEvent(result, start), start)).toEqual([
      { id: "late", name: "render_workspace", state: "error", detail: "Invalid dashboard" },
    ]);
  });

  it("matches out-of-order results and concurrent same-name calls by their saved IDs", () => {
    const [entry] = replayLastTurn([], {
      session: { status: "complete" },
      events: [
        event("user_prompt", "Organize my inboxes"),
        event("tool_start", "render_workspace", { tool_call_id: "valid", args: { spec: "large dashboard" } }),
        event("tool_end", "render_workspace", {
          tool_call_id: "invalid",
          is_error: true,
          summary: "Invalid dashboard",
        }),
        event("tool_end", "render_workspace", { tool_call_id: "valid", summary: "Workspace 30 rendered" }),
        event("assistant_message", "Dashboard updated."),
        event("tool_start", "render_workspace", { tool_call_id: "invalid", args: { spec: "large dashboard" } }),
      ],
    });
    expect(entry.text).toBe("Dashboard updated.");
    expect(entry.tools).toEqual([
      { id: "valid", name: "render_workspace", state: "complete", detail: "Workspace 30 rendered" },
      { id: "invalid", name: "render_workspace", state: "error", detail: "Invalid dashboard" },
    ]);
    expect(entry.status?.status).toBe("complete");
  });

  it("uses compact descriptions and never leaves a terminal run spinning without a saved result", () => {
    const events = [event("tool_start", "codemode", { tool_call_id: "code", args: { code: "private long source" } })];
    const running = replayLastTurn([], { session: { status: "running" }, events })[0];
    expect(running.tools?.[0]).toMatchObject({
      state: "running",
      detail: "Investigate and classify available evidence",
    });
    const completed = replayLastTurn([], { session: { status: "complete" }, events })[0];
    expect(completed.tools?.[0]).toMatchObject({
      state: "error",
      detail: "No saved result — open History for details",
    });
    expect(JSON.stringify(completed)).not.toContain("private long source");
  });

  it("reconciles only the latest turn and retains earlier conversation entries", () => {
    const earlier = { role: "assistant" as const, text: "Earlier answer" };
    const result = replayLastTurn([earlier, { role: "user", text: "New question" }, { role: "assistant" }], {
      session: { status: "complete" },
      events: [
        event("user_prompt", "Old question"),
        event("assistant_message", "Old answer"),
        event("user_prompt", "New question"),
        event("assistant_message", "New answer"),
      ],
    });
    expect(result[0]).toEqual(earlier);
    expect(result[2].text).toBe("New answer");
  });
});
