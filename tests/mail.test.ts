import { describe, expect, it } from "vitest";
import { sanitizeMessageHtml } from "@/lib/mail";

describe("message HTML", () => {
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
