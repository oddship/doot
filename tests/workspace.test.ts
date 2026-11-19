import { describe, expect, it } from "vitest";
import { MAX_PROPOSAL_ITEMS } from "@/lib/proposal-limits";
import {
  generatedWorkspaceJsonSchema,
  generatedWorkspaceSchema,
  parseWorkspace,
  workspaceJsonSchemaForProposalLimit,
} from "@/lib/workspace";

const base = (root: any) => ({
  schemaVersion: 1,
  title: "Inbox organization",
  summary: "A safe generated workspace.",
  root,
});
describe("generated workspace schema", () => {
  it("uses the configured limit for generated review actions", () => {
    const workspace = base({
      type: "stack",
      children: [
        {
          type: "action_group",
          actions: [
            {
              label: "Review archive",
              intent: {
                type: "create_proposal",
                action: "archive",
                reason: "Reviewed",
                items: Array.from({ length: 1000 }, (_, index) => ({
                  account: "work",
                  uid: String(index + 1),
                  source_folder: "INBOX",
                })),
              },
            },
          ],
        },
      ],
    });
    expect(() => parseWorkspace(workspace, 100)).toThrow("1–100");
    expect(parseWorkspace(workspace, 1000).root).toEqual(workspace.root);
    const maxima: number[] = [];
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.properties?.type?.const === "create_proposal") maxima.push(node.properties.items.maxItems);
      Object.values(node).forEach(visit);
    };
    visit(workspaceJsonSchemaForProposalLimit(1000));
    expect(maxima.length).toBeGreaterThan(0);
    expect(maxima.every((limit) => limit === 1000)).toBe(true);
  });

  it.each([42, MAX_PROPOSAL_ITEMS, MAX_PROPOSAL_ITEMS + 1])(
    "validates a review action containing %i messages against the shared proposal limit",
    (count) => {
      const result = generatedWorkspaceSchema.safeParse(
        base({
          type: "action_group",
          actions: [
            {
              label: "Review archive",
              intent: {
                type: "create_proposal",
                action: "archive",
                reason: "Reviewed batch",
                items: Array.from({ length: count }, (_, index) => ({
                  account: "work",
                  uid: String(index + 1),
                  source_folder: "INBOX",
                })),
              },
            },
          ],
        }),
      );
      expect(result.success).toBe(count <= MAX_PROPOSAL_ITEMS);
    },
  );

  const nodes = [
    { type: "heading", text: "Priorities", description: "Recent important mail" },
    { type: "metric", label: "Needs reply", value: "4", tone: "attention" },
    {
      type: "message_group",
      title: "People",
      messages: [{ account: "work", uid: "12", sender: "A Person", subject: "Hello" }],
    },
    { type: "table", title: "Senders", columns: ["Sender", "Count"], rows: [["A", "2"]] },
    { type: "chart", title: "Volume", kind: "bar", data: [{ label: "Updates", value: 8 }] },
    { type: "sender_cluster", sender: "news@example.com", count: 5, summary: "Recurring newsletter" },
    {
      type: "flow_suggestion",
      title: "Archive updates",
      description: "Review this suggestion before creating a proposal.",
    },
    { type: "search_link", label: "GitHub notifications", query: "github", count: 12, tags: ["automation", "review"] },
    { type: "note", title: "Safety", body: "No mailbox changes have been applied." },
    { type: "action_group", actions: [{ label: "View mail", intent: { type: "filter_inbox", query: "invoice" } }] },
    {
      type: "grid",
      columns: 2,
      children: [
        { type: "metric", label: "One", value: "1" },
        { type: "metric", label: "Two", value: "2" },
      ],
    },
    { type: "stack", children: [{ type: "note", body: "Nested content" }] },
  ];
  it.each(nodes.map((node) => [node.type, node]))("accepts %s", (_type, node) =>
    expect(generatedWorkspaceSchema.safeParse(base(node)).success).toBe(true),
  );
  it("rejects unknown keys", () =>
    expect(generatedWorkspaceSchema.safeParse({ ...base(nodes[0]), html: "<script>bad()</script>" }).success).toBe(
      false,
    ));
  it("rejects arbitrary URLs", () =>
    expect(
      generatedWorkspaceSchema.safeParse(
        base({
          type: "action_group",
          actions: [{ label: "Go", intent: { type: "open_url", url: "https://evil.test" } }],
        }),
      ).success,
    ).toBe(false));
  it("allows deletion proposals only as validated review intents", () =>
    expect(
      generatedWorkspaceSchema.safeParse(
        base({
          type: "action_group",
          actions: [
            {
              label: "Review delete",
              intent: {
                type: "create_proposal",
                action: "delete",
                reason: "Repeated unwanted alerts",
                items: [{ account: "a", uid: "1", source_folder: "INBOX" }],
              },
            },
          ],
        }),
      ).success,
    ).toBe(true));
  it("rejects mailbox proposals without an exact source folder", () =>
    expect(
      generatedWorkspaceSchema.safeParse(
        base({
          type: "action_group",
          actions: [
            {
              label: "Ambiguous archive",
              intent: {
                type: "create_proposal",
                action: "archive",
                reason: "Missing folder reference",
                items: [{ account: "a", uid: "1" }],
              },
            },
          ],
        }),
      ).success,
    ).toBe(false));
  it("rejects mismatched table rows", () =>
    expect(
      generatedWorkspaceSchema.safeParse(base({ type: "table", columns: ["A", "B"], rows: [["one"]] })).success,
    ).toBe(false));
  it("rejects deeply nested payloads", () => {
    let node: any = { type: "note", body: "bottom" };
    for (let i = 0; i < 9; i++) node = { type: "stack", children: [node] };
    expect(generatedWorkspaceSchema.safeParse(base(node)).success).toBe(false);
  });
  it("rejects oversized payloads", () =>
    expect(() => parseWorkspace(base({ type: "note", body: "x".repeat(100_001) }))).toThrow());
  it("exposes the complete recursive contract to the Agent tool", () => {
    const encoded = JSON.stringify(generatedWorkspaceJsonSchema);
    expect(encoded).toContain("message_group");
    expect(encoded).toContain("create_proposal");
    expect(encoded).toContain("additionalProperties");
  });
  it("allows semantic tags on displayed messages", () =>
    expect(
      generatedWorkspaceSchema.safeParse(
        base({
          type: "message_group",
          title: "Priority",
          messages: [{ account: "work", uid: "9", sender: "A", subject: "B", tags: ["priority", "reply"] }],
        }),
      ).success,
    ).toBe(true));
  it("allows generated flow cards to open a persisted flow", () =>
    expect(
      generatedWorkspaceSchema.safeParse(
        base({
          type: "flow_suggestion",
          title: "Archive CI",
          description: "Review first",
          action: { label: "Review", intent: { type: "open_flow", flowId: 3 } },
        }),
      ).success,
    ).toBe(true));
  it("keeps legacy rule cards compatible", () =>
    expect(
      generatedWorkspaceSchema.safeParse(
        base({
          type: "rule_suggestion",
          title: "Legacy",
          description: "Still safe",
          action: { label: "Review", intent: { type: "open_rule", ruleId: 2 } },
        }),
      ).success,
    ).toBe(true));
});
