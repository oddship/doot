import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactCss, readAppCss } from "./source-contract";

describe("widescreen UI contract", () => {
  it("uses an active top navigation and a reader-oriented inbox split", async () => {
    const layout = await readFile("app/layout.tsx", "utf8");
    const header = await readFile("components/app-header.tsx", "utf8");
    const nav = await readFile("components/top-nav.tsx", "utf8");
    const css = compactCss(await readAppCss());
    expect(layout).toContain("<AppHeader />");
    expect(header).toContain("<TopNav");
    expect(nav).toContain('aria-current={active ? "page"');
    expect(css).toContain("grid-template-columns:minmax(520px,35%) minmax(0,65%)");
  });

  it("isolates complex email HTML and keeps remote content visibly blocked", async () => {
    const inbox = await readFile("components/inbox-client.tsx", "utf8");
    const frame = await readFile("components/email-frame.tsx", "utf8");
    const mail = await readFile("lib/mail.ts", "utf8");
    expect(inbox).toContain("<EmailFrame html={detail.body_html_sanitized}");
    expect(frame).toContain('sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(frame).not.toContain("allow-scripts");
    expect(mail).toContain("remote-image-placeholder");
  });

  it("provides a repeatable 1920px screenshot audit", async () => {
    const audit = await readFile("scripts/ui-audit.mjs", "utf8");
    expect(audit).toContain("width: 1920, height: 1080");
    expect(audit).toContain("horizontalOverflow");
    expect(audit).toContain("consoleErrors");
  });
});
