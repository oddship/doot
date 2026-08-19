import { describe, expect, it } from "vitest";
import { planMailboxSync } from "@/lib/sync-selection";

describe("mailbox sync planning", () => {
  it("fills older gaps even when the newest UID is already cached", () => {
    const plan = planMailboxSync([1, 2, 3, 4, 5, 6], [5, 6], 5);
    expect(plan.desired).toEqual([2, 3, 4, 5, 6]);
    expect(plan.missing).toEqual([2, 3, 4]);
    expect(plan.backfilled).toBe(3);
  });

  it("prioritizes the newest target window and deduplicates server results", () => {
    const plan = planMailboxSync([8, 3, 9, 8, 10, 7], [3, 8], 3);
    expect(plan.desired).toEqual([8, 9, 10]);
    expect(plan.missing).toEqual([9, 10]);
    expect(plan.backfilled).toBe(0);
  });

  it("caps pathological targets", () => {
    const eligible = Array.from({ length: 10_050 }, (_, index) => index + 1);
    expect(planMailboxSync(eligible, [], 50_000).desired).toHaveLength(10_000);
  });
});
