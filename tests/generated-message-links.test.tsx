import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceBoundary } from "@/components/generated-workspace";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/lib/client-navigation", () => ({ navigateClient: navigate }));
vi.mock("@/components/feedback", () => ({ useToast: () => ({}), ConfirmDialog: () => null }));
it("renders keyboard-focusable message links and preserves modified-click browser behavior", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  try {
    const value = {
      schemaVersion: 1,
      title: "Messages",
      summary: "Safe fixture",
      root: {
        type: "message_group",
        title: "Matches",
        messages: [
          {
            account: "work",
            uid: "42",
            folder: "Inbox & notes",
            subject: "Review this message",
            sender: "sender@example.test",
          },
        ],
      },
    };
    await act(async () => root.render(<WorkspaceBoundary value={value} />));
    const link = el.querySelector<HTMLAnchorElement>("a.message-row")!;
    expect(link).not.toBeNull();
    expect(link.tabIndex).toBe(0);
    expect(link.getAttribute("aria-label")).toContain("Review this message");
    const params = new URL(link.href).searchParams;
    expect(params.get("account")).toBe("work");
    expect(params.get("folder")).toBe("Inbox & notes");
    expect(params.get("open")).toBe("42");
    link.focus();
    expect(document.activeElement).toBe(link);
    const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => link.click());
    expect(navigate).toHaveBeenCalledWith(link.getAttribute("href"));
  } finally {
    await act(async () => root.unmount());
    el.remove();
    vi.unstubAllGlobals();
  }
});
