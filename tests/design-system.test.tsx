// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { Button, EmptyState, PageHeader } from "@/components/ui";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Oatbase integration", () => {
  it("ships the exact pinned stylesheet, including empty and message patterns", () => {
    const provenance = JSON.parse(readFileSync("app/vendor/oatbase/provenance.json", "utf8"));
    const css = readFileSync("app/vendor/oatbase/oatbase.css");
    expect(createHash("sha256").update(css).digest("hex")).toBe(provenance.sha256);
    expect(provenance.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(css.toString()).toContain('[data-variant="empty"]');
    expect(css.toString()).toContain("[data-message]");
    expect(readFileSync("app/globals.css", "utf8")).toContain('"./vendor/oatbase/oatbase.css"');
  });

  it("keeps native button names and disabled behavior when adapting Oat variants", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let clicked = false;
    try {
      await act(async () =>
        root.render(
          <>
            <Button variant="outline">Review changes</Button>
            <Button
              variant="danger"
              disabled
              onClick={() => {
                clicked = true;
              }}
            >
              Apply changes
            </Button>
            <Button variant="ghost" size="icon" tooltip="Open settings">
              <span aria-hidden="true">⚙</span>
            </Button>
          </>,
        ),
      );
      const buttons = container.querySelectorAll("button");
      expect(buttons[0].classList.contains("outline")).toBe(true);
      expect(buttons[1].dataset.variant).toBe("danger");
      buttons[1].click();
      expect(clicked).toBe(false);
      expect(buttons[2].getAttribute("aria-label")).toBe("Open settings");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("provides a named heading and useful native navigation in an empty screen", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(
          <>
            <PageHeader title="Inbox" description="Read and organize your email." />
            <EmptyState title="Connect your email" description="Add an IMAP account to get started.">
              <a href="/settings#accounts">Add account</a>
            </EmptyState>
          </>,
        ),
      );
      expect(container.querySelectorAll("h1")).toHaveLength(1);
      expect(container.querySelector("h1")?.textContent).toBe("Inbox");
      expect(container.querySelector('[data-variant="empty"] a')?.getAttribute("href")).toBe("/settings#accounts");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
