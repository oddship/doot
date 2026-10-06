// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { openDurableAgent } from "@/lib/agent-durable";

it("runs production Durable tools, retains transcript/approval budget across reopening, and keeps codemode bounded", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "doot-agent-durable-"));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  let state = { selected: [{ account: "fake", folder: "INBOX", uid: "1" }], used: 0 };
  let session: Awaited<ReturnType<typeof openDurableAgent>> | undefined;
  const events: any[] = [];
  const tools = () => [
    {
      name: "email_search",
      description: "Mock search",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      outputSchema: {},
      execute: async () => {
        state.used++;
        return { content: [{ type: "text", text: "found" }], details: { total: 1 }, structuredContent: { total: 1 } };
      },
    },
  ];
  const open = () =>
    openDurableAgent({
      id: "test-agent",
      models,
      model: faux.getModel(),
      thinking: "off",
      prompt: "Use the tools safely.",
      tools,
      capture: () => state,
      restore: (value) => {
        state = value;
      },
      storagePath: path.join(directory, "session.sqlite"),
    });
  try {
    session = await open();
    session.subscribe((event) => events.push(event));
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("email_search", { query: "mock" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done")]),
    ]);
    await session.prompt("Search the mock cache");
    expect(state.used).toBe(1);
    expect(events.some((event) => event.type === "tool_execution_end" && event.result?.details?.total === 1)).toBe(
      true,
    );
    await session.dispose();
    state = { selected: [], used: 0 };
    session = await open();
    expect(state.used).toBe(1);
    expect(state.selected[0].uid).toBe("1");
    session.subscribe((event) => events.push(event));
    await session.recover();
    expect(state.used).toBe(1);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code: 'return await tools.email_search({query: "mock"});' })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("Script done")]),
    ]);
    await session.prompt("Batch the same mock search");
    expect(state.used).toBe(2);
    expect(events.some((event) => event.type === "tool_execution_start" && event.parentToolCallId)).toBe(true);
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("codemode", { code: 'return await tools.memory_set({namespace:"x",key:"x",value:"x"});' })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Blocked script")]),
    ]);
    await session.prompt("Try a forbidden script mutation");
    expect(state.used).toBe(2);
  } finally {
    await session?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
