import { describe, expect, it } from "vitest";
import { parseWorkspace } from "@/lib/workspace";
import { applyWorkspacePatch } from "@/lib/workspace-patch";

const workspace = () => ({
  schemaVersion: 1 as const,
  title: "Inbox overview",
  summary: "The current dashboard",
  root: {
    type: "stack" as const,
    children: [
      { type: "note" as const, title: "Priority", body: "Review these first" },
      { type: "metric" as const, label: "Unread", value: "12" },
    ],
  },
});

describe("incremental workspace patches", () => {
  it("replaces content without changing unaffected nodes", () => {
    const before = workspace();
    const after = applyWorkspacePatch(before, [
      { op: "replace", path: "/root/children/0/body", value: "Nothing urgent today" },
    ]);

    expect(parseWorkspace(after).root).toEqual({
      type: "stack",
      children: [{ type: "note", title: "Priority", body: "Nothing urgent today" }, before.root.children[1]],
    });
    expect(before.root.children[0].body).toBe("Review these first");
  });

  it("adds and removes dashboard components", () => {
    const added = applyWorkspacePatch(workspace(), [
      {
        op: "add",
        path: "/root/children/-",
        value: {
          type: "search_link",
          label: "GitHub failures",
          query: "from:notifications@github.com failed",
          count: 3,
        },
      },
    ]);
    const removed = applyWorkspacePatch(added, [{ op: "remove", path: "/root/children/1" }]);
    const parsed = parseWorkspace(removed);

    expect(parsed.root.type).toBe("stack");
    if (parsed.root.type === "stack") {
      expect(parsed.root.children).toHaveLength(2);
      expect(parsed.root.children[1].type).toBe("search_link");
    }
  });

  it("requires values for add and replace", () => {
    expect(() => applyWorkspacePatch(workspace(), [{ op: "replace", path: "/title" }])).toThrow(
      "replace requires a value",
    );
  });

  it("rejects schema version and prototype paths", () => {
    expect(() => applyWorkspacePatch(workspace(), [{ op: "replace", path: "/schemaVersion", value: 2 }])).toThrow(
      "schemaVersion",
    );
    expect(() =>
      applyWorkspacePatch(workspace(), [{ op: "add", path: "/root/__proto__/polluted", value: true }]),
    ).toThrow("unsafe");
  });

  it("rejects missing paths and out-of-bounds array edits", () => {
    expect(() =>
      applyWorkspacePatch(workspace(), [{ op: "replace", path: "/root/missing/value", value: "x" }]),
    ).toThrow("does not exist");
    expect(() => applyWorkspacePatch(workspace(), [{ op: "remove", path: "/root/children/9" }])).toThrow(
      "out of bounds",
    );
  });

  it("still relies on the full workspace schema for unsafe component values", () => {
    const patched = applyWorkspacePatch(workspace(), [
      { op: "replace", path: "/root/children/0", value: { type: "html", value: "<script>bad()</script>" } },
    ]);
    expect(() => parseWorkspace(patched)).toThrow();
  });
});
