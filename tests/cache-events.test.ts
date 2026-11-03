import { afterEach, beforeEach, expect, it, vi } from "vitest";

class Socket {
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor(public url: string) {
    Socket.instances.push(this);
  }
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("shares one connection, keeps healthy idle tabs quiet, and closes only after the last subscriber", async () => {
  const { subscribeCacheEvents } = await import("@/lib/cache-events");
  const first = vi.fn(),
    second = vi.fn();
  const one = subscribeCacheEvents(first),
    two = subscribeCacheEvents(second);
  expect(Socket.instances).toHaveLength(1);
  const socket = Socket.instances[0];
  socket.onopen?.();
  vi.advanceTimersByTime(30000);
  expect(first).not.toHaveBeenCalled();
  socket.onmessage?.({ data: '{"type":"cache.refresh","resource":"messages"}' });
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  one();
  expect(socket.close).not.toHaveBeenCalled();
  two();
  expect(socket.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("ignores malformed frames, isolates subscriber failures and refreshes after a disconnect", async () => {
  const { subscribeCacheEvents } = await import("@/lib/cache-events");
  const one = subscribeCacheEvents(() => {
    throw new Error("view failed");
  });
  const listener = vi.fn(),
    two = subscribeCacheEvents(listener);
  const socket = Socket.instances[0];
  socket.onmessage?.({ data: "not json" });
  expect(listener).not.toHaveBeenCalled();
  socket.onmessage?.({ data: '{"type":"cache.refresh","resource":"jobs"}' });
  expect(listener).toHaveBeenCalledOnce();
  socket.onclose?.();
  vi.advanceTimersByTime(1000);
  expect(Socket.instances).toHaveLength(2);
  Socket.instances[1].readyState = 3;
  vi.advanceTimersByTime(9000);
  expect(listener).toHaveBeenCalledWith({ type: "cache.refresh", resource: "all" });
  one();
  two();
});
