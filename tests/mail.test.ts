import { describe, expect, it } from "vitest";
import { sanitizeMessageHtml } from "@/lib/mail";

describe("message HTML", () => {
  it("removes zero-width hidden preheaders without dropping the visible message", () => {
    const value = sanitizeMessageHtml(
      '<div data-email-preheader="true" style="visibility:hidden;height:0px;max-height:0;width:0px;overflow:hidden;opacity:0;mso-hide:all">Hidden preview text</div><table width="512"><tr><td><p>Visible message body</p></td></tr></table>',
    );
    expect(value).not.toContain("Hidden preview text");
    expect(value).not.toContain("width:0px");
    expect(value).toContain("Visible message body");
    expect(value).toContain('width="512"');
  });

  it("discards hidden snippets and nested contents for common email hiding patterns", () => {
    for (const attrs of [
      'style="display:none!important;width:0px"',
      'style="visibility:hidden;width:0px"',
      'style="mso-hide:all;width:0px"',
      "hidden",
      'data-email-preheader="true"',
    ]) {
      const value = sanitizeMessageHtml(`<div ${attrs}><span>Preview only</span></div><p>Real body</p>`);
      expect(value).not.toContain("Preview only");
      expect(value).toContain("Real body");
    }
  });

  it("preserves safe inline-block layouts and unitless line height, not URL-based styles", () => {
    const value = sanitizeMessageHtml(
      '<a href="https://example.com" style="display:inline-block;width:100%;line-height:1.25;position:fixed;background:url(https://tracker.test/pixel)">Readable text</a>',
    );
    expect(value).toContain("display:inline-block");
    expect(value).toContain("line-height:1.25");
    expect(value).not.toContain("position");
    expect(value).not.toContain("tracker.test");
  });
  it("removes scripts and blocks remote images by default", () => {
    const value = sanitizeMessageHtml(
      '<script>alert(1)</script><img src="https://tracker.test/pixel" alt="pixel"><p>Hello</p>',
    );
    expect(value).not.toContain("script");
    expect(value).not.toContain("https://tracker.test");
    expect(value).toContain("Remote image blocked");
    expect(value).toContain("Hello");
  });
  it("adds safe link attributes", () => {
    const value = sanitizeMessageHtml('<a href="https://example.com">open</a>');
    expect(value).toContain('rel="noreferrer noopener"');
    expect(value).toContain('target="_blank"');
  });
  it("can allow remote images only when explicitly configured", () =>
    expect(sanitizeMessageHtml('<img src="https://example.com/a.png">', true)).toContain("https://example.com/a.png"));
  it("keeps constrained presentation styles but rejects positioning and URL backgrounds", () => {
    const value = sanitizeMessageHtml(
      '<div style="color:#334455;font-size:16px;position:fixed;background-image:url(https://bad.test/x)">Hello</div>',
    );
    expect(value).toContain("color:#334455");
    expect(value).toContain("font-size:16px");
    expect(value).not.toContain("position");
    expect(value).not.toContain("background-image");
  });
});
