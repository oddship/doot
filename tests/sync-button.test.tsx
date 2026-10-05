import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncButton } from "@/components/sync-button";

const { apiJson, toast } = vi.hoisted(() => ({
  apiJson: vi.fn(),
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/client-api", () => ({ apiJson, errorMessage: (error: Error) => error.message }));
vi.mock("@/components/feedback", () => ({ useToast: () => toast }));

class MockSocket {
  static current: MockSocket;
  onmessage?: (event: { data: string }) => void;
  close = vi.fn();
  constructor() {
    MockSocket.current = this;
  }
  send(job: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: "sync.status", job }) });
  }
}

const idle = { id: null, status: "idle", accounts: [] };
const running = { id: "sync-1", status: "running", accounts: [{ status: "syncing" }, { status: "waiting" }] };
const done = { id: "sync-1", status: "done", accounts: [{ status: "done" }, { status: "done" }] };
let root: Root;
let container: HTMLDivElement;
const button = () => container.querySelector("button")!;
async function render() {
  await act(async () => root.render(<SyncButton icon={<span>Sync icon</span>} />));
}
async function click() {
  await act(async () => button().dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
async function receive(job: unknown) {
  await act(async () => MockSocket.current.send(job));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", MockSocket);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionStorage.setItem("email-agent-start-sync", "checked");
  apiJson.mockResolvedValue(idle);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("header sync feedback", () => {
  it("immediately announces a click, shows a spinner, and prevents repeat requests", async () => {
    await render();
    let finish!: (job: unknown) => void;
    apiJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click();
    expect(button().textContent).toContain("Starting sync…");
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-busy")).toBe("true");
    expect(button().querySelector(".spin")).not.toBeNull();
    expect(toast.info).toHaveBeenCalledWith("Starting mail sync", expect.stringContaining("keep browsing"));
    await click();
    expect(apiJson.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => finish(running));
    expect(button().textContent).toContain("Syncing 0/2");
    await receive(done);
    await receive(done);
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain("Synced 2/2");
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Mail synced", expect.stringContaining("2 account(s)"));
  });

  it("does not announce historical completion or let the initial GET erase click feedback", async () => {
    apiJson.mockResolvedValue(done);
    await render();
    expect(toast.success).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    root = createRoot(container);
    let initial!: (job: unknown) => void;
    apiJson.mockImplementation((_url, init) =>
      init?.method === "POST"
        ? new Promise(() => {})
        : new Promise((resolve) => {
            initial = resolve;
          }),
    );
    await render();
    await click();
    await act(async () => initial(idle));
    expect(button().textContent).toContain("Starting sync…");
    expect(button().disabled).toBe(true);
  });

  it("shows actionable request failures and enables retry", async () => {
    await render();
    apiJson.mockRejectedValueOnce(new Error("Connection unavailable"));
    await click();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain("Sync failed");
    expect(toast.error).toHaveBeenCalledWith("Could not start mail sync", "Connection unavailable");
    apiJson.mockResolvedValueOnce(running);
    await click();
    expect(button().textContent).toContain("Syncing 0/2");
  });

  it("reports partial failures even when an account has no error string", async () => {
    await render();
    apiJson.mockResolvedValueOnce(running);
    await click();
    await receive({ ...done, accounts: [{ status: "done" }, { status: "error" }] });
    expect(button().textContent).toContain("Sync failed 2/2");
    expect(button().className).toContain("button-danger");
    expect(toast.error).toHaveBeenCalledWith(
      "Mail sync finished with errors",
      expect.stringContaining("1/2 accounts failed"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("recovers completion through polling without live messages and cleans up timers", async () => {
    vi.useFakeTimers();
    await render();
    apiJson.mockResolvedValueOnce(running);
    await click();
    apiJson.mockResolvedValueOnce(done);
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(button().textContent).toContain("Synced 2/2");
    expect(toast.success).toHaveBeenCalledTimes(1);
    const calls = apiJson.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(apiJson).toHaveBeenCalledTimes(calls);
  });

  it("ignores stale running responses after live completion", async () => {
    await render();
    let finish!: (job: unknown) => void;
    apiJson.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click();
    await receive(running);
    await receive(done);
    await act(async () => finish(running));
    expect(button().textContent).toContain("Synced 2/2");
    expect(button().disabled).toBe(false);
  });

  it("explains when no accounts are connected instead of celebrating an empty sync", async () => {
    await render();
    apiJson.mockResolvedValueOnce({ ...done, accounts: [] });
    await click();
    expect(toast.info).toHaveBeenCalledWith("No accounts to sync", expect.stringContaining("Settings"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });
});
