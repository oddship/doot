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
    expect(audit).toContain("width: 390, height: 844");
    expect(audit).toContain("horizontalOverflow");
    expect(audit).toContain("consoleErrors");
  });

  it("contains narrow layouts without clipping the primary navigation or Inbox toolbar", async () => {
    const inbox = await readFile("components/inbox-client.tsx", "utf8");
    const globals = await readFile("app/globals.css", "utf8");
    const [responsive, mailReader] = await Promise.all([
      readFile("app/styles/responsive.css", "utf8"),
      readFile("app/styles/mail-reader.css", "utf8"),
    ]);
    expect(globals.trim().endsWith('@import "./styles/responsive.css";')).toBe(true);
    expect(responsive).toContain("overflow-x: auto");
    expect(responsive).toContain(".session-list");
    expect(mailReader).toContain("container-type: inline-size");
    expect(mailReader).toContain("grid-column: 1 / -1");
    expect(mailReader).toContain("minmax(220px, 320px) minmax(300px, 1fr) auto");
    expect(mailReader).toContain(".inbox-search-control");
    expect(inbox).toContain('className="inbox-toolbar"');
    expect(inbox).toContain('className="inbox-select-page"');
    expect(inbox).toContain("Search cached mail");
    expect(inbox.indexOf('className="inbox-toolbar"')).toBeLessThan(inbox.indexOf('<section className="inbox-list">'));
  });
});
