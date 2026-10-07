// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";

const directory = mkdtempSync(path.join(tmpdir(), "doot-classifier-settings-"));
process.env.DOOT_DATABASE_PATH = path.join(directory, "cache.sqlite3");
const { db } = await import("@/lib/database");
const { store } = await import("@/lib/store");

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

it("persists and clears classifier preference independently of the conversation model", async () => {
  const defaults = (await store(["settings-get"])).settings;
  expect(defaults.classifier_provider).toBe("");
  expect(defaults.classifier_model).toBe("");
  await store(["settings-set", JSON.stringify({ agent_provider: "chat-provider", agent_model: "chat-model" })]);
  await store(["settings-set", JSON.stringify({ classifier_provider: "opencode", classifier_model: "jev-1.13-free" })]);
  expect((await store(["settings-get"])).settings).toMatchObject({
    agent_provider: "chat-provider",
    agent_model: "chat-model",
    classifier_provider: "opencode",
    classifier_model: "jev-1.13-free",
  });
  expect(
    JSON.parse((db.prepare("SELECT value_json FROM settings WHERE key='classifier_model'").get() as any).value_json),
  ).toBe("jev-1.13-free");
  await store(["settings-set", JSON.stringify({ classifier_provider: "", classifier_model: "" })]);
  expect((await store(["settings-get"])).settings).toMatchObject({
    agent_model: "chat-model",
    classifier_provider: "",
    classifier_model: "",
  });
});
