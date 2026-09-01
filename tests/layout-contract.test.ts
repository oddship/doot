// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactCss, readAppCss } from "./source-contract";

describe("application page width", () => {
  it("keeps all standard pages full-width like the workspace", async () => {
    const css = compactCss(await readAppCss());
    expect(css).toContain(".page{width:100%;max-width:none;margin:0;padding:28px;}");
    expect(css).not.toContain("max-width:1440px");
  });

  it("preserves exact badge text for email addresses and identifiers", async () => {
    const css = compactCss(await readAppCss());
    expect(css).not.toContain("text-transform:capitalize");
  });

  it("gives generated search cards a full-width content row and stable footer action", async () => {
    const [workspace, cssSource] = await Promise.all([
      readFile("components/generated-workspace.tsx", "utf8"),
      readAppCss(),
    ]);
    const css = compactCss(cssSource);
    expect(css).toContain(".search-link-card{display:flex;flex-direction:column;align-items:stretch");
    expect(css).toContain(".search-link-card>.button{align-self:flex-start;margin-top:auto;");
    expect(css).toContain(".generated-workspace{container-type:inline-size;");
    expect(css).toContain(".search-match-count{flex:none;white-space:nowrap;");
    expect(workspace).toContain('node.count.toLocaleString("en-IN")');
  });

  it("compacts adjacent generated Flow suggestions and removes redundant empty draft panes", async () => {
    const [workspace, drafts, css] = await Promise.all([
      readFile("components/generated-workspace.tsx", "utf8"),
      readFile("components/drafts-client.tsx", "utf8"),
      readAppCss(),
    ]);
    expect(workspace).toContain("workspace-flow-grid");
    expect(workspace).toContain("isFlowSuggestion");
    expect(drafts).toContain("drafts-layout-empty");
    expect(css).toContain(".drafts-layout-empty .draft-editor");
  });
});
