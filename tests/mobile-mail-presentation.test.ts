import { describe, expect, it } from "vitest";
import { formatCompactTimestamp, formatUserTimestamp } from "@/components/local-time";
import { senderDisplayName } from "@/lib/mail-presentation";

describe("compact mail presentation", () => {
  it("uses the display name without losing bare-address senders", () => {
    expect(senderDisplayName('"Marketing Team" <mail@example.test>')).toBe("Marketing Team");
    expect(senderDisplayName("Alice <alice@example.test>")).toBe("Alice");
    expect(senderDisplayName("<alice@example.test>")).toBe("alice@example.test");
    expect(senderDisplayName("alice@example.test")).toBe("alice@example.test");
  });
  it("uses local calendar days rather than UTC days for today's short time", () => {
    const value = "2026-11-10T20:30:00Z";
    const now = new Date("2026-11-11T03:00:00Z");
    expect(formatCompactTimestamp(value, "en-US", "Asia/Kolkata", now)).toBe("2:00 AM");
    expect(formatCompactTimestamp(value, "en-US", "UTC", now)).toBe("Nov 10");
    expect(formatUserTimestamp(value, "datetime", "en-IN", "Asia/Kolkata")).toContain("11/11/2026");
  });
  it("includes the year for old mail and preserves malformed dates", () => {
    expect(formatCompactTimestamp("2024-01-02T12:00:00Z", "en-US", "UTC", new Date("2026-11-11T00:00:00Z"))).toBe(
      "Jan 2, 2024",
    );
    expect(formatCompactTimestamp("unknown")).toBe("unknown");
  });
});
