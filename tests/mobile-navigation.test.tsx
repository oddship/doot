import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "@/components/app-header";

const { navigateClient } = vi.hoisted(() => ({ navigateClient: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/inbox" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/sync-button", () => ({ SyncButton: () => <button type="button">Sync</button> }));
vi.mock("@/lib/client-navigation", () => ({ navigateClient }));
vi.mock("@/lib/client-app-state", () => ({ flushAppStateWrites: () => Promise.resolve() }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("compact mobile navigation", () => {
  it("keeps all destinations available and returns focus after choosing a route", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<AppHeader />));
      const opener = container.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!;
      opener.focus();
      await act(async () => opener.click());
      const dialog = container.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(dialog.querySelectorAll("a")).toHaveLength(6);
      expect(dialog.querySelector('[aria-current="page"]')?.textContent).toBe("Inbox");
      await act(async () => dialog.querySelector<HTMLAnchorElement>('a[href="/drafts"]')!.click());
      expect(navigateClient).toHaveBeenCalledWith("/drafts");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
