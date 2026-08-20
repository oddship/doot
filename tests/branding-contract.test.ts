import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactCss, readAppCss } from "./source-contract";

describe("Doot brand", () => {
  it("uses the endorsed product name and messenger positioning", async () => {
    const layout = await readFile("app/layout.tsx", "utf8");
    const header = await readFile("components/app-header.tsx", "utf8");
    const brand = await readFile("BRAND.md", "utf8");
    const mark = await readFile("public/doot-mark.svg", "utf8");
    expect(layout).toContain("Doot — your email emissary");
    expect(header).toContain("by oddship");
    expect(header).toContain("/doot-mark.svg");
    expect(mark).toContain("Doot messenger mark");
    expect(mark).toContain("#e4a326");
    expect(brand).toContain("trusted emissary for your inbox");
    expect(brand).toContain("Doot may prepare; the user approves");
  });

  it("keeps the warm paper, deep-ocean, and marigold visual tokens", async () => {
    const css = compactCss(await readAppCss());
    expect(css).toContain("--bg:#f5f1e8");
    expect(css).toContain("--ocean-deep:#0d292c");
    expect(css).toContain("--marigold:#e4a326");
    expect(css).toContain(".brand-copy");
  });

  it("carries the product theme into the Moat documentation", async () => {
    const layout = await readFile("docs/_layout.html", "utf8");
    const theme = compactCss(await readFile("docs/_static/theme.css", "utf8"));
    const oatIndex = layout.indexOf("@knadh/oat/oat.min.css");
    const themeIndex = layout.indexOf("_static/theme.css");

    expect(oatIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeGreaterThan(oatIndex);
    expect(theme).toContain("--background:#f5f1e8");
    expect(theme).toContain("--primary:#006d77");
    expect(theme).toContain("--warning:#b86f12");
    expect(theme).toContain('html[data-theme="dark"]');
    expect(theme).toContain("--primary:#e4a326");
  });
});
