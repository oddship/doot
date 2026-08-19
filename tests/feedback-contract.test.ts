// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("application feedback", () => {
  it("provides global accessible toasts and reusable confirmation dialogs", async () => {
    const feedback = await readFile("components/feedback.tsx", "utf8");
    const layout = await readFile("app/layout.tsx", "utf8");
    expect(layout).toContain("<FeedbackProvider>");
    expect(feedback).toContain('aria-live="polite"');
    expect(feedback).toContain('role={item.tone === "error" ? "alert" : "status"}');
    expect(feedback).toContain("export function ConfirmDialog");
  });

  it("does not use native browser alert or confirm prompts", async () => {
    const paths = [
      "components/rules-client.tsx",
      "components/folder-manager.tsx",
      "components/memory-manager.tsx",
      "components/settings-client.tsx",
      "components/inbox-client.tsx",
      "components/generated-workspace.tsx",
    ];
    const sources = await Promise.all(paths.map((path) => readFile(path, "utf8")));
    for (const source of sources) {
      expect(source).not.toMatch(/\balert\s*\(/);
      expect(source).not.toMatch(/\bconfirm\s*\(/);
    }
  });

  it("uses modal confirmation for destructive choices and toasts for outcomes", async () => {
    const sources = await Promise.all([
      readFile("components/rules-client.tsx", "utf8"),
      readFile("components/folder-manager.tsx", "utf8"),
      readFile("components/memory-manager.tsx", "utf8"),
      readFile("components/settings-client.tsx", "utf8"),
      readFile("components/generated-workspace.tsx", "utf8"),
    ]);
    for (const source of sources) expect(source).toContain("ConfirmDialog");
    expect(sources.join("\n")).toContain("toast.success");
    expect(sources.join("\n")).toContain("toast.error");
  });
});
