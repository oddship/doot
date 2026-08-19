import { describe, expect, it } from "vitest";
import { formatUserTimestamp } from "@/components/local-time";

describe("localized timestamps", () => {
  it("formats Indian dates day-first with a four-digit year", () => {
    expect(formatUserTimestamp("2026-08-18T12:30:00Z", "date", "en-IN", "Asia/Kolkata")).toBe("18/08/2026");
  });

  it("includes localized time in Inbox-style timestamps", () => {
    const value = formatUserTimestamp("2026-08-18T12:30:00Z", "datetime", "en-IN", "Asia/Kolkata");
    expect(value).toContain("18/08/2026");
    expect(value).toMatch(/06:00\s*pm/i);
  });
});
