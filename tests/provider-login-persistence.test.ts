// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("@/lib/agent-runtime", () => ({
  getAgentModelRuntime: async () => ({
    getProvider: () => ({ id: "fake", name: "Synthetic provider", auth: { apiKey: { login: true } } }),
    login: fake.login,
  }),
}));
vi.mock("@/lib/store", () => ({ emitBackground: vi.fn() }));
const dir = mkdtempSync(path.join(tmpdir(), "doot-login-"));
process.env.DOOT_DATABASE_PATH = path.join(dir, "cache.sqlite");
const { db } = await import("@/lib/database");
const { startProviderLogin, getProviderLogin, respondToProviderLogin, listProviderLogins } = await import(
  "@/lib/provider-auth"
);
afterAll(() => {
  db.close();
  delete (globalThis as any).__emailAgentDatabase;
  delete (globalThis as any).__dootProviderLogins;
  delete process.env.DOOT_DATABASE_PATH;
  rmSync(dir, { recursive: true, force: true });
});
it("discovers a login without its dialog and retains public results without submitted secrets", async () => {
  fake.login.mockImplementation(async (_provider: any, _type: any, hooks: any) => {
    await hooks.prompt({ type: "secret", message: "Synthetic key" });
  });
  const login = await startProviderLogin("fake", "api_key");
  const restored = listProviderLogins().sessions.find((item: any) => item.id === login.id)!;
  expect(restored.status).toBe("waiting");
  expect(restored.prompt?.message).toBe("Synthetic key");
  respondToProviderLogin(login.id, restored.prompt!.id, "synthetic-secret-never-in-progress");
  await vi.waitFor(() => expect(getProviderLogin(login.id).status).toBe("complete"));
  (globalThis as any).__dootProviderLogins.clear();
  expect(getProviderLogin(login.id).status).toBe("complete");
  expect(JSON.stringify(db.prepare("SELECT value_json FROM app_state").all())).not.toContain(
    "synthetic-secret-never-in-progress",
  );
});
it("restores interrupted login progress as an explicit error with no active prompt", () => {
  db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(
    "provider-login:interrupted",
    JSON.stringify({
      owner: "previous-process",
      view: { id: "interrupted", status: "waiting", prompt: { id: "old", message: "Old prompt" } },
    }),
  );
  const view = getProviderLogin("interrupted");
  expect(view.status).toBe("error");
  expect(view.error).toContain("restart");
  expect(view.prompt).toBeUndefined();
});
