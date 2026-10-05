// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvedBodyBatch, BODY_ACCESS_LIMITS, bodyRefKey, compactMessageBody } from "@/lib/agent-body-access";
import { conversationFlowIds } from "@/lib/agent-flow-access";

const { store, emitBackground } = vi.hoisted(() => ({ store: vi.fn(), emitBackground: vi.fn() }));
vi.mock("@/lib/store", () => ({ store, emitBackground }));
vi.mock("@/lib/agent-credential-store", () => ({ sqliteAgentCredentialStore: {} }));
vi.mock("@/lib/drafts", () => ({ getDraft: vi.fn(), saveLocalDraft: vi.fn() }));

import { toolsFor } from "@/lib/agent-runtime";

const refs = Array.from({ length: 60 }, (_, i) => ({ account: "work", folder: "INBOX", uid: String(i + 1) }));
function state() {
  return {
    id: "conversation-1",
    selected: refs.slice(0, 50),
    selectedSearch: { account: "work", query: "subject:puzzle" },
    createdFlowIds: new Set<number>(),
    readBodyKeys: new Set<string>(),
    validatedSearches: new Set(["work\nsubject:puzzle"]),
    sink: vi.fn(),
  } as any;
}
function tool(name: string, current = state()) {
  return toolsFor(current).find((t) => t.name === name);
}
const original = {
  id: 16,
  name: "Archive puzzle",
  account: "work",
  query: "subject:puzzle",
  action: "archive",
  enabled: true,
  status: "active",
  source: "agent",
  rationale: "Original rationale",
};
beforeEach(() => {
  vi.clearAllMocks();
  store.mockImplementation(async (args: string[]) => {
    if (args[0] === "rule-get") return { rule: original };
    if (args[0] === "rule-list") return { rules: [] };
    if (args[0] === "rule-upsert" || args[0] === "rule-agent-suggest")
      return { rule: { ...JSON.parse(args[1]), id: JSON.parse(args[1]).id || 16 } };
    if (args[0] === "read-batch")
      return {
        metrics: { requested: JSON.parse(args[1]).length },
        messages: JSON.parse(args[1]).map((ref: any) => ({
          ...ref,
          body_text: "Useful text",
          body_html: "SECRET RAW HTML",
          password: "SECRET",
        })),
      };
    if (args[0] === "search") return { messages: refs.slice(0, 26), total: 26 };
    if (args[0] === "message-context") return { messages: JSON.parse(args[1]) };
    return {};
  });
});

describe("approved body review", () => {
  it("pages only exact browser-approved folder-scoped references", () => {
    expect(approvedBodyBatch(refs.slice(0, 26), { offset: 20 })).toMatchObject({
      messages: refs.slice(20, 25),
      approved_total: 26,
      next_offset: 25,
    });
    expect(approvedBodyBatch(refs.slice(0, 26), { offset: 25 }).next_offset).toBeNull();
    expect(() => approvedBodyBatch(refs, { messages: [{ ...refs[0], folder: "Archive" }] })).toThrow("approved");
    expect(() => approvedBodyBatch(refs.slice(0, 5), { messages: [refs[10]] })).toThrow("approved");
    expect(() => approvedBodyBatch(refs, { limit: 6 })).toThrow("five");
  });
  it("keeps reference tuple boundaries unambiguous", () => {
    expect(bodyRefKey({ account: "a\nb", folder: "c", uid: "1" })).not.toBe(
      bodyRefKey({ account: "a", folder: "b\nc", uid: "1" }),
    );
  });
  it("rejects invalid excerpt offsets before fetching approved bodies", async () => {
    for (const body_offset of [-1, 0.5, Number.NaN]) {
      await expect(tool("email_read_selected").execute("read", { body_offset })).rejects.toThrow(
        "non-negative integer",
      );
    }
    expect(store).not.toHaveBeenCalled();
  });
  it("returns bounded plain text without HTML, credentials, or raw attachment data", () => {
    const result = compactMessageBody({
      ...refs[0],
      body_text: "x".repeat(9000),
      body_html: "secret",
      password: "secret",
      attachments: [{ filename: "a.txt", content_type: "text/plain", content: "secret", size: 4 }],
    });
    expect(result.attachments).toEqual([{ filename: "a.txt", contentType: "text/plain", size: 4 }]);
    expect(result.body_text).toHaveLength(BODY_ACCESS_LIMITS.textChars);
    expect(result.body_truncated).toBe(true);
    expect(result.body_next_offset).toBe(BODY_ACCESS_LIMITS.textChars);
    const tail = compactMessageBody({ body_text: "x".repeat(9000) }, result.body_next_offset!);
    expect(tail.body_text).toHaveLength(3000);
    expect(tail.body_next_offset).toBeNull();
    expect(() => compactMessageBody({ body_text: "text" }, -1)).toThrow("non-negative");
    expect(JSON.stringify(result)).not.toContain("secret");
    const fallback = compactMessageBody({ body_html: "<script>bad()</script><div hidden>Preview</div><p>Hello</p>" });
    expect(fallback.body_text).toContain("Hello");
    expect(fallback.body_text).not.toMatch(/bad|Preview/);
  });
  it("snapshots the current search without reading bodies or granting access", async () => {
    const current = state();
    current.selected = [];
    const result = await tool("email_request_body_access", current).execute("request", {
      scope: "current_search",
      reason: "Review this category",
    });
    expect(result.details).toMatchObject({
      status: "approval_required",
      scope: { account: "work", query: "subject:puzzle", total: 26 },
    });
    expect(result.details.messages).toHaveLength(26);
    expect(current.selected).toEqual([]);
    expect(store.mock.calls.some(([args]) => args[0] === "read")).toBe(false);
    expect(current.sink).toHaveBeenCalledWith(expect.objectContaining({ type: "data-read-approval" }));
  });
  it("requires a browser-selected search and caps approval snapshots", async () => {
    const current = state();
    current.selectedSearch = undefined;
    await expect(
      tool("email_request_body_access", current).execute("request", { scope: "current_search", reason: "Review" }),
    ).rejects.toThrow("Select an Inbox search");
    await expect(
      tool("email_request_body_access").execute("request", { scope: "current_search", limit: 51, reason: "Review" }),
    ).rejects.toThrow("50");
    expect(store).not.toHaveBeenCalled();
  });
  it("permits approved reads from codemode, never unapproved or future matches", async () => {
    const current = state();
    const read = tool("email_read_selected", current);
    expect(read.exposure).toBe("direct");
    expect(read.outputSchema).toEqual({});
    const result = await read.execute("read", { offset: 5 });
    expect(result.details.next_offset).toBe(10);
    expect(result.details.messages).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(store.mock.calls.filter(([args]) => args[0] === "read-batch")).toHaveLength(1);
    store.mockClear();
    await expect(read.execute("read", { messages: [refs[55]] })).rejects.toThrow("approved");
    expect(store).not.toHaveBeenCalled();
  });
  it("enforces a shared distinct-body budget across concurrent tool calls", async () => {
    const current = state();
    current.selected = refs;
    const read = tool("email_read_selected", current);
    for (let offset = 0; offset < 50; offset += 5) await read.execute("read", { offset });
    await read.execute("repeat", { offset: 0 });
    store.mockClear();
    await expect(read.execute("over", { offset: 50 })).rejects.toThrow("budget");
    expect(store).not.toHaveBeenCalled();
  });
});

describe("conversation Flow management", () => {
  it("records creation ownership and allows an in-place partial edit on a later turn", async () => {
    const current = state();
    await tool("email_suggest_flow", current).execute("create", {
      name: original.name,
      account: original.account,
      query: original.query,
      action: "archive",
      rationale: "Review",
    });
    expect(current.createdFlowIds.has(16)).toBe(true);
    const result = await tool("email_update_selected_flow", current).execute("edit", { id: 16, action: "delete" });
    expect(result.details).toMatchObject({
      id: 16,
      name: original.name,
      query: original.query,
      action: "delete",
      enabled: false,
      status: "suggested",
      rationale: original.rationale,
    });
    expect(
      store.mock.calls.filter(([args]) => args[0] === "rule-upsert" || args[0] === "rule-agent-suggest"),
    ).toHaveLength(2);
  });
  it("supports selected Flow edits but inspection alone never grants permission", async () => {
    const current = state();
    const inspected = await tool("email_get_flow", current).execute("inspect", { id: 16 });
    expect(inspected.details.editable).toBe(false);
    await expect(
      tool("email_update_selected_flow", current).execute("edit", { id: 16, action: "delete" }),
    ).rejects.toThrow("Do not create a replacement");
    expect(store.mock.calls.some(([args]) => args[0] === "rule-upsert")).toBe(false);
    current.selectedRule = original;
    await expect(
      tool("email_update_selected_flow", current).execute("edit", { id: 16, action: "delete" }),
    ).resolves.toMatchObject({ details: { id: 16, enabled: false } });
  });
  it("rejects unvalidated edits and duplicate replacement suggestions", async () => {
    const current = state();
    current.createdFlowIds.add(16);
    current.validatedSearches.clear();
    await expect(
      tool("email_update_selected_flow", current).execute("edit", { id: 16, action: "delete" }),
    ).rejects.toThrow("Validate");
    current.validatedSearches.add("work\nsubject:puzzle");
    store.mockImplementation(async (args) => (args[0] === "rule-list" ? { rules: [original] } : {}));
    await expect(
      tool("email_suggest_flow", current).execute("create", { ...original, action: "delete" }),
    ).rejects.toThrow("Flow 16 already exists");
    expect(store.mock.calls.some(([args]) => args[0] === "rule-upsert")).toBe(false);
  });
  it("keeps Flow edits model-only and deletion/activation behind browser review", async () => {
    expect(tool("email_get_flow").exposure).toBe("direct");
    expect(tool("email_list_flows").exposure).toBe("direct");
    expect(tool("email_update_selected_flow").exposure).toBe("model-only");
    const result = await tool("email_get_flow").execute("get", { id: 16 });
    expect(result.details.deletion_requires_browser_confirmation).toBe(true);
    expect(toolsFor(state()).some((t) => /delete_flow|run_flow|activate_flow/.test(t.name))).toBe(false);
  });
  it("restores only recorded creation provenance, not inspection, selected edits, or errors", () => {
    expect([
      ...conversationFlowIds([
        { event_type: "flow_created", metadata: { flow_id: 12 } },
        { event_type: "flow_access_inherited", metadata: { flow_ids: [13] } },
        {
          event_type: "tool_end",
          content: "email_suggest_flow",
          metadata: { is_error: false, result_preview: JSON.stringify({ details: { id: 16 } }) },
        },
        {
          event_type: "tool_end",
          content: "email_suggest_flow",
          metadata: { is_error: true, result_preview: JSON.stringify({ details: { id: 17 } }) },
        },
        {
          event_type: "tool_end",
          content: "email_get_flow",
          metadata: { is_error: false, result_preview: JSON.stringify({ details: { id: 18 } }) },
        },
      ]),
    ]).toEqual([12, 13, 16]);
  });
});
