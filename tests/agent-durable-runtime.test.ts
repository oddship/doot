// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";

const { runtime } = vi.hoisted(() => ({ runtime: { current: undefined as any } }));
vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
  ...(await original<any>()),
  ModelRuntime: { create: async () => runtime.current },
}));

it("continues the same production conversation after runtime reopen and deduplicates History projection", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "doot-runtime-transition-"));
  process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite");
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  runtime.current = models;
  const { db } = await import("@/lib/database");
  const { runAgent, closeAgentRuntime } = await import("@/lib/agent-runtime");
  try {
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("memory_set", { namespace: "preferences", key: "test", value: "local-only" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Preference saved.")]),
    ]);
    const first: any[] = [];
    const id = await runAgent({ text: "Remember my test preference" }, (event) => first.push(event));
    expect(
      first
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Preference saved.");
    expect(db.prepare("SELECT COUNT(*) count FROM agent_memory").get()).toEqual({ count: 1 });
    await closeAgentRuntime();
    faux.setResponses([fauxAssistantMessage([fauxText("Continuing the same conversation.")])]);
    const second: any[] = [];
    expect(await runAgent({ sessionId: id, text: "Continue" }, (event) => second.push(event))).toBe(id);
    expect(
      second
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
    ).toBe("Continuing the same conversation.");
    expect(db.prepare("SELECT COUNT(*) count FROM agent_sessions").get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='assistant_message'").get()).toEqual({
      count: 2,
    });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='tool_end'").get()).toEqual({
      count: 1,
    });
    expect(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_type='tool_start'").get()).toEqual({
      count: 1,
    });
  } finally {
    await closeAgentRuntime();
    db.close();
    delete (globalThis as any).__emailAgentDatabase;
    delete process.env.DOOT_DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});
