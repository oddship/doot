// @vitest-environment node
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
    const css = compactCss(await readAppCss());
    expect(css).toContain(".search-link-card{display:flex;flex-direction:column;align-items:stretch");
    expect(css).toContain(".search-link-card>.button{align-self:flex-start;margin-top:auto;");
  });
});
