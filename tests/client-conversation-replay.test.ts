import { describe, expect, it } from "vitest";
import { applyConversationToolEvent, replayConversation, replayLastTurn } from "@/lib/client-conversation";

const event = (event_type: string, content: string, metadata = {}) => ({ event_type, content, metadata });

describe("conversation history replay", () => {
  it("clears a previous turn's answer and approval while the continuation starts", () => {
    const [entry] = replayLastTurn(
      [{ role: "assistant", text: "Earlier findings", readApproval: { id: "old", reason: "Read", messages: [] } }],
      { session: { status: "running" }, events: [event("user_prompt", "Continue approved review")] },
    );
    expect(entry.text).toBeUndefined();
    expect(entry.readApproval).toBeUndefined();
    expect(entry.status?.status).toBe("running");
  });
  it("restores authoritative review counts separately from model prose", () => {
    const progress = {
      review_id: "review-1",
      total: 157,
      bodies_read: 100,
      fully_read: 20,
      decided: 90,
      dispositions: { delete: 80, retain: 2, uncertain: 8 },
    };
    const [entry] = replayLastTurn([], {
      session: { status: "complete" },
      events: [
        event("user_prompt", "Continue this review"),
        event("assistant_message", "A stale model estimate"),
        event("body_review_progress", "", { progress }),
      ],
    });
    expect(entry.reviewProgress).toEqual(progress);
    expect(entry.text).toBe("A stale model estimate");
  });
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

it("rebuilds saved turns, body decisions, and artifact cards without browser storage", () => {
  const entries = replayConversation({
    session: { status: "complete" },
    events: [
      event("user_prompt", "First"),
      event("body_read_requested", "Read", { request: { id: "request", messages: [] } }),
      event("body_read_decided", "approved", { request_id: "request", status: "approved" }),
      event("user_prompt", "Continue"),
      event("assistant_message", "Done"),
      event("artifact_created", "Saved", { artifact: { id: 1, title: "Draft" } }),
    ],
  });
  expect(entries).toHaveLength(4);
  expect(entries[1].readApproval?.status).toBe("approved");
  expect(entries[3].artifact).toEqual({ id: 1, title: "Draft" });
  expect(entries[3].text).toBe("Done");
});
