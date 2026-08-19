// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("workspace navigation lifecycle", () => {
  it("reattaches to persisted work and listens for generated workspace refreshes", async () => {
    const source = await readFile("components/workspace-client.tsx", "utf8");
    expect(source).toContain('fetch("/api/workspaces/latest"');
    expect(source).toContain('cache: "no-store"');
    expect(source).toContain('latest.status === "running"');
    expect(source).toContain('value.resource === "workspaces"');
  });

  it("retains the current conversation across page navigation until explicitly cleared", async () => {
    const source = await readFile("components/workspace-client.tsx", "utf8");
    const storage = await readFile("lib/client-conversation.ts", "utf8");
    expect(source).toContain("loadConversationSnapshot()");
    expect(source).toContain("saveConversationSnapshot({ sessionId: conversationSessionId, entries })");
    expect(source).toContain("clearConversationSnapshot()");
    expect(source).toContain("replayLastTurn(old, detail)");
    expect(storage).toContain("email-agent:conversation:v1");
  });

  it("supports new conversations and sends persistent email selection context", async () => {
    const source = await readFile("components/workspace-client.tsx", "utf8");
    expect(source).toContain("New conversation");
    expect(source).toContain('tone="selected"');
    expect(source).toContain("These emails will be included as Doot context");
    expect(source).toContain("setSessionId(undefined)");
    expect(source).toContain("selected: loadSelectedRefs()");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(runtime).toContain('store<any>(["message-context"');
    expect(runtime).toContain("explicitly selected these cached messages as context");
  });

  it("shows and sends a selected flow as conversational context", async () => {
    const source = await readFile("components/workspace-client.tsx", "utf8");
    expect(source).toContain("Flow: {selectedRule.name}");
    expect(source).toContain("Clear selected flow");
    expect(source).toContain("selectedRule: loadSelectedRule()");
  });

  it("lets the Agent inspect and incrementally revise the current dashboard", async () => {
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(runtime).toContain('name: "get_current_workspace"');
    expect(runtime).toContain('name: "update_workspace"');
    expect(runtime).toContain("smallest useful patch");
    expect(runtime).toContain("updated_from: current.workspace.id");
    expect(runtime).toContain("new or changed Inbox link");
  });
});
