// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createCacheBroadcaster } from "@/lib/cache-notifications.mjs";

afterEach(() => vi.useRealTimers());
it("coalesces job bursts while preserving final per-message removal receipts", () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const broadcast = createCacheBroadcaster(send);
  for (let i = 0; i < 100; i++) broadcast({ type: "cache.refresh", resource: "jobs" });
  broadcast({
    type: "cache.refresh",
    resource: "messages",
    items: [{ account: "a", uid: "1", source_folder: "INBOX", cache_hidden: false }],
  });
  broadcast({
    type: "cache.refresh",
    resource: "messages",
    items: [
      { account: "a", uid: "1", source_folder: "INBOX", cache_hidden: true },
      { account: "a", uid: "2", source_folder: "INBOX", cache_hidden: true },
    ],
  });
  expect(send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0].items).toHaveLength(2);
  expect(send.mock.calls[1][0].items[0].cache_hidden).toBe(true);
  broadcast({ type: "sync.status", job: { status: "done" } });
  expect(send).toHaveBeenCalledTimes(3);
  broadcast.close();
});
