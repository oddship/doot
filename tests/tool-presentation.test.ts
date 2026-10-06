import { describe, expect, it } from "vitest";
import { compactEmailSearchResult, toolInputSummary, toolResultSummary } from "@/lib/tool-presentation";

describe("Agent tool presentation", () => {
  it("shows the complete ordered action plan in proposal and Flow summaries", () => {
    const plan = { action: "move", actions: ["mark_read", "move"], target_folder: "transactions" };
    expect(toolInputSummary("email_suggest_flow", { ...plan, query: "bank" })).toContain(
      "Mark as read → Move to transactions",
    );
    for (const name of ["email_suggest_flow", "email_update_selected_flow", "email_propose_organization"])
      expect(toolResultSummary(name, { details: plan })).toContain("Mark as read → Move to transactions");
  });
  it("removes repetitive database-only fields from model search results", () => {
    const result = compactEmailSearchResult({
      messages: [
        {
          account: "a",
          account_email: "a@example.com",
          uid: 7,
          sender: "S",
          subject: "Hi",
          date: "today",
          date_ts: 123,
          unread: 1,
          body_fetched: 0,
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
      next_offset: null,
      filters: {},
    });
    expect(result.messages[0]).toEqual({
      account: "a",
      uid: "7",
      sender: "S",
      subject: "Hi",
      date: "today",
      unread: true,
    });
    expect(result.messages[0]).not.toHaveProperty("account_email");
    expect(result.messages[0]).not.toHaveProperty("date_ts");
  });

  it("shows useful query and result summaries instead of generic completion", () => {
    expect(toolInputSummary("email_search", { account: "personal", query: "domain:example.com" })).toContain(
      "domain:example.com",
    );
    expect(toolResultSummary("email_search", { details: { total: 189, messages: [{}, {}], next_offset: 20 } })).toBe(
      "189 matches · 2 returned · more available",
    );
    expect(toolResultSummary("email_suggest_flow", { details: { name: "Archive alerts" } })).toContain(
      "Archive alerts",
    );
  });
});
