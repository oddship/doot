// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { historyEventLabel, visibleUserPrompt } from "@/lib/history-display";

describe("history prompt privacy", () => {
  it("shows the original message without legacy injected context", () => {
    expect(
      visibleUserPrompt(
        'refine this search\n\nThe user explicitly selected this current Inbox search as context.\n{"query":"domain:example.com"}',
      ),
    ).toBe("refine this search");
    expect(visibleUserPrompt("keep the whole user message")).toBe("keep the whole user message");
  });

  it("turns legacy organization instructions into a user-facing action", () => {
    expect(visibleUserPrompt("Analyze the complete cache with email_facets and investigate useful clusters")).toBe(
      "Organize inboxes",
    );
  });

  it("persists visible input and sanitizes legacy events at the read boundary", async () => {
    const [runtime, store] = await Promise.all([
      readFile("lib/agent-runtime.ts", "utf8"),
      readFile("lib/store.ts", "utf8"),
    ]);
    expect(runtime).toContain('content: input.organize ? "Organize inboxes" : input.text');
    expect(runtime).not.toContain('event_type: "user_prompt", role: "user", content: prompt');
    expect(store).toContain('row.event_type === "user_prompt" ? visibleUserPrompt(row.content)');
    expect(store).toContain("first_prompt: visibleUserPrompt(session.first_prompt)");
    expect(historyEventLabel("user_prompt")).toBe("User message");
  });
});
