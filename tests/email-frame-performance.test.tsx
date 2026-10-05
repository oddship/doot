import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EmailFrame } from "@/components/email-frame";

it("coalesces frame resize notifications and cancels old measurements when content changes", async () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  const raf = vi.fn((callback: FrameRequestCallback) => {
    callbacks.set(++next, callback);
    return next;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancel);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EmailFrame html="<p>First</p>" />));
    const frame = container.querySelector("iframe")!;
    Object.defineProperty(frame.contentDocument!.documentElement, "scrollHeight", { configurable: true, value: 900 });
    await act(async () => frame.dispatchEvent(new Event("load")));
    resize();
    resize();
    expect(raf).toHaveBeenCalledTimes(1);
    await act(async () => {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => {
        callback(0);
      });
    });
    expect(frame.style.height).toBe("900px");
    resize();
    resize();
    expect(raf).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<EmailFrame html="<p>Second</p>" />));
    expect(disconnect).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    expect(frame.style.height).toBe("420px");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-scripts");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
