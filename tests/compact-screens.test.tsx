import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ResponsiveDetails } from "@/components/responsive-details";
import { settingsSection } from "@/lib/settings-sections";

afterEach(() => vi.unstubAllGlobals());
it("collapses secondary content on compact screens without removing it or its actions", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let change = () => {};
  const media = {
    matches: true,
    addEventListener: (_: string, fn: () => void) => {
      change = fn;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => media);
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const action = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ResponsiveDetails label="Details">
          <p>Full original explanation</p>
          <button type="button" onClick={action}>
            Review
          </button>
        </ResponsiveDetails>,
      ),
    );
    const details = el.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(el.textContent).toContain("Full original explanation");
    expect(action).not.toHaveBeenCalled();
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(details.open).toBe(true);
    await act(async () => {
      media.matches = false;
      change();
    });
    expect(details.open).toBe(true);
    await act(async () => {
      media.matches = true;
      change();
    });
    expect(details.open).toBe(false);
    expect(action).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    el.remove();
  }
});
it("resolves Settings deep links, including saved item links", () => {
  expect(settingsSection("#agent")).toBe("agent");
  expect(settingsSection("#schedules")).toBe("schedules");
  expect(settingsSection("#artifact-42")).toBe("artifacts");
  expect(settingsSection("#unknown")).toBe("accounts");
});
