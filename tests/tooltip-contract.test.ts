// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readAppCss } from "./source-contract";

describe("explanatory tooltips", () => {
  it("provides reusable button and content tooltips for hover and keyboard focus", async () => {
    const [ui, css] = await Promise.all([readFile("components/ui.tsx", "utf8"), readAppCss()]);
    expect(ui).toContain("tooltip?: string");
    expect(ui).toContain("data-tooltip={tooltip}");
    expect(ui).toContain('role="tooltip"');
    expect(css).toContain(".button[data-tooltip]:focus-visible::after");
    expect(css).toContain(".tooltip-root:focus-within");
    expect(ui).toContain('aria-label={ariaLabel || (size === "icon" ? tooltip : undefined)}');
  });

  it("explains ambiguous actions across primary workflows", async () => {
    const sources = await Promise.all(
      [
        "components/rules-client.tsx",
        "components/workspace-client.tsx",
        "components/inbox-client.tsx",
        "components/drafts-client.tsx",
        "components/settings-client.tsx",
        "components/generated-workspace.tsx",
      ].map((path) => readFile(path, "utf8")),
    );
    for (const source of sources) expect(source.match(/tooltip=/g)?.length || 0).toBeGreaterThan(1);
  });
});
