import { describe, expect, it } from "vitest";
import { requiresReviewAction } from "@/lib/agent-review-mode";

describe("review intent", () => {
  it.each([
    "Review all 157 emails for deletion",
    "Recommend inbox cleanup candidates; read-only, no proposals",
    "Summarise the messages and suggest what matters",
    "Organize this inbox without creating flows",
    "Review existing flows; do not create proposals",
  ])("does not demand an automation for %s", (text) => expect(requiresReviewAction(text)).toBe(false));
  it.each([
    "Suggest a flow for my inbox",
    "Create an archive proposal",
    "Prepare rules for newsletters",
    "Suggest a Flow with a read-only preview and no mailbox changes",
  ])("keeps the explicit review-action requirement for %s", (text) => expect(requiresReviewAction(text)).toBe(true));
  it("keeps proactive Organize behaviour unless explicitly restricted", () => {
    expect(requiresReviewAction("", true)).toBe(true);
    expect(requiresReviewAction("read-only analysis, no flows", true)).toBe(false);
  });
});
