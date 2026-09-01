// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { isTransientImapError, withImapRetry } from "@/lib/imap-retry";

describe("IMAP retries", () => {
  it("recognizes transient transport and server failures", () => {
    expect(isTransientImapError({ code: "ECONNRESET" })).toBe(true);
    expect(isTransientImapError(new Error("server temporarily unavailable"))).toBe(true);
    expect(isTransientImapError(new Error("authentication failed"))).toBe(false);
    expect(isTransientImapError(new Error("mailbox does not exist"))).toBe(false);
  });

  it("retries transient failures with a fresh operation", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("connection lost"), { code: "ECONNRESET" }))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();

    await expect(withImapRetry(operation, { baseDelayMs: 0, onRetry })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry permanent failures", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("authentication failed"));
    await expect(withImapRetry(operation, { baseDelayMs: 0 })).rejects.toThrow("authentication failed");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
