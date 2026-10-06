// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { openDurableAgent } from "@/lib/agent-durable";

it("does not replay a production tool interrupted after its local effect and restores its reserved budget", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "doot-production-recovery-"));
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  let state = { selected: ["fake/INBOX/1"], used: 0 };
  let effects = 0;
  let reached!: () => void;
  const effectReached = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let session: Awaited<ReturnType<typeof openDurableAgent>> | undefined;
  const open = () =>
    openDurableAgent({
      id: "recovery-test",
      models,
      model: faux.getModel(),
      thinking: "off",
      prompt: "Use only the approved tool.",
      storagePath: path.join(directory, "session.sqlite"),
      capture: () => state,
      restore: (value) => {
        state = value;
      },
      tools: () => [
        {
          name: "approved_read",
          description: "Mock approved read",
          parameters: { type: "object", properties: {} },
          execute: async (_id: string, _args: any, signal: AbortSignal) => {
            state.used++;
            await session!.saveContext();
            effects++;
            reached();
            await new Promise<void>((_resolve, reject) => {
              if (signal.aborted) reject(new Error("shutdown"));
              else signal.addEventListener("abort", () => reject(new Error("shutdown")), { once: true });
            });
            return { content: [{ type: "text", text: "mock" }], details: {} };
          },
        },
      ],
    });
  try {
    session = await open();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("approved_read", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Interrupted read; no replay.")]),
    ]);
    const pending = session.prompt("Read only the exact approved reference").catch(() => undefined);
    await effectReached;
    await session.dispose();
    await pending;
    state = { selected: [], used: 0 };
    session = await open();
    expect(state).toEqual({ selected: ["fake/INBOX/1"], used: 1 });
    const events: any[] = [];
    session.subscribe((event) => events.push(event));
    await session.recover();
    expect(effects).toBe(1);
    expect(state.used).toBe(1);
    expect(events.some((event) => event.type === "tool_execution_end" && event.isError)).toBe(true);
  } finally {
    await session?.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
