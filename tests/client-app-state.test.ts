import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("coalesces rapid edits and flushes the latest value of every key before navigation", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({});
  for (let i = 0; i < 50; i++) state.writeAppState("composer", String(i));
  state.writeAppState("selection", ["one"]);
  expect(fetch).not.toHaveBeenCalled();
  expect(state.hasPendingAppStateWrite("composer")).toBe(true);
  await state.flushAppStateWrites();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ key: "composer", value: "49" });
  expect(state.hasPendingAppStateWrite("composer")).toBe(false);
});
it("does not overwrite edits while a previous save is in flight, and does not announce unchanged state", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({ composer: "initial" });
  const storage = vi.fn();
  window.addEventListener("storage", storage);
  let finish!: (response: any) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  state.writeAppState("composer", "first");
  const flush = state.flushAppStateWrites();
  state.writeAppState("composer", "second");
  state.refreshAppState({ composer: "stale" });
  expect(state.readAppState("composer")).toBe("second");
  finish({ ok: true });
  await flush;
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).value).toBe("second");
  state.refreshAppState({ composer: "second" });
  expect(storage).not.toHaveBeenCalled();
  state.refreshAppState({ composer: "remote edit" });
  expect(storage).toHaveBeenCalledOnce();
  window.removeEventListener("storage", storage);
});
it("keeps failed saves visible and blocks navigation until a successful retry", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({});
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "offline" }) } as Response);
  state.writeAppState("composer", "save me");
  await expect(state.flushAppStateWrites()).rejects.toThrow("offline");
  state.writeAppState("composer", "retry");
  await expect(state.flushAppStateWrites()).resolves.toBeUndefined();
});

it("rejects an old read even after the local save finishes", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({ composer: "initial" });
  const readRevision = state.appStateRevision();
  state.writeAppState("composer", "new edit");
  await state.flushAppStateWrites();
  state.refreshAppState({ composer: "initial" }, readRevision);
  expect(state.readAppState("composer")).toBe("new edit");
});
it("retries a failed key without requiring a new edit", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({});
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  state.writeAppState("selection", ["one"]);
  await expect(state.flushAppStateWrites()).rejects.toThrow("offline");
  await vi.advanceTimersByTimeAsync(1000);
  expect(state.hasPendingAppStateWrite("selection")).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("starts every pending save synchronously on pagehide", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({});
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  state.writeAppState("composer", "draft");
  state.writeAppState("selection", ["one"]);
  state.flushAppStateOnPageHide();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls.every(([, options]) => options?.keepalive)).toBe(true);
});

it("lets navigation proceed after a permanent rejection and retains the local edit", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({});
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ error: "draft not found" }),
  } as Response);
  state.writeAppState("draft", "my edit");
  await expect(state.flushAppStateWrites()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(30000);
  expect(fetch).toHaveBeenCalledTimes(1);
  state.refreshAppState({ draft: "stale" });
  expect(state.readAppState("draft")).toBe("my edit");
});
it("ignores a read started while a prior save was still committing", async () => {
  const state = await import("@/lib/client-app-state");
  state.initializeAppState({ composer: "old" });
  let finish!: (value: any) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  state.writeAppState("composer", "new");
  const flush = state.flushAppStateWrites();
  const revision = state.appStateRevision();
  finish({ ok: true });
  await flush;
  state.refreshAppState({ composer: "old" }, revision);
  expect(state.readAppState("composer")).toBe("new");
});
