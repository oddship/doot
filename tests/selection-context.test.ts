// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { consumeAgentHandoff, saveAgentHandoff } from "@/lib/client-agent-handoff";
import { loadSelectedIds, loadSelectedRefs, saveSelectedIds } from "@/lib/client-selection";

describe("persistent selected email context", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists validated account and UID references across pages", () => {
    saveSelectedIds(["work:12", "personal:34", "invalid"]);
    expect(loadSelectedIds()).toEqual(["work:12", "personal:34"]);
    expect(loadSelectedRefs()).toEqual([
      { account: "work", uid: "12" },
      { account: "personal", uid: "34" },
    ]);
  });

  it("deduplicates selection and caps context at 100 messages", () => {
    saveSelectedIds([...Array.from({ length: 120 }, (_, index) => `work:${index + 1}`), "work:1"]);
    expect(loadSelectedIds()).toHaveLength(100);
  });

  it("hands an editable reply prompt to the Agent exactly once", () => {
    saveAgentHandoff({ prompt: "Draft a reply using the selected message." });
    expect(consumeAgentHandoff()).toEqual({ prompt: "Draft a reply using the selected message." });
    expect(consumeAgentHandoff()).toBeNull();
  });
});
