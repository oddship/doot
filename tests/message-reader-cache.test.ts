import { afterEach, expect, it, vi } from "vitest";
import { MessageReaderCache } from "@/lib/message-reader-cache";

afterEach(() => vi.useRealTimers());
it("expires viewed content and clears it on invalidation", () => {
  vi.useFakeTimers();
  const cache = new MessageReaderCache(1000, 100);
  cache.set("one", { text: "viewed" });
  expect(cache.get("one")).toEqual({ text: "viewed" });
  vi.advanceTimersByTime(101);
  expect(cache.get("one")).toBeUndefined();
  cache.set("two", { text: "viewed" });
  cache.clear();
  expect(cache.get("two")).toBeUndefined();
});
it("evicts least-recently used messages under the byte budget and rejects oversized bodies", () => {
  const cache = new MessageReaderCache(60);
  cache.set("one", "a".repeat(20));
  cache.set("two", "b".repeat(20));
  cache.get("one");
  cache.set("three", "c".repeat(20));
  expect(cache.get("two")).toBeUndefined();
  expect(cache.get("one")).toBe("a".repeat(20));
  cache.set("huge", "x".repeat(100));
  expect(cache.get("huge")).toBeUndefined();
});
