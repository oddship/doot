// @vitest-environment node
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "@/components/markdown-content";

describe("agent Markdown", () => {
  it("renders GFM without enabling raw HTML or remote images", async () => {
    const source = await readFile("components/markdown-content.tsx", "utf8");
    expect(source).toContain("remarkGfm");
    expect(source).not.toContain("rehypeRaw");
    expect(source).toContain("markdown-image-blocked");
    expect(source).toContain('rel="noopener noreferrer"');
    const html = renderToStaticMarkup(
      createElement(
        MarkdownContent,
        null,
        "**Paid**\n\n- ₹949\n\n<script>alert('bad')</script>\n\n![track](https://tracker.example/pixel)",
      ),
    );
    expect(html).toContain("<strong>Paid</strong>");
    expect(html).toContain("<li>₹949</li>");
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });

  it("uses Markdown only for non-user conversation content and history responses", async () => {
    const [workspace, history] = await Promise.all([
      readFile("components/workspace-client.tsx", "utf8"),
      readFile("app/history/[id]/page.tsx", "utf8"),
    ]);
    expect(workspace).toContain('entry.role === "user"');
    expect(workspace).toContain("<MarkdownContent>{entry.text}</MarkdownContent>");
    expect(history).toContain("<MarkdownContent>{event.content}</MarkdownContent>");
  });
});
