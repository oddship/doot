// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readApiRoutes } from "./source-contract";

describe("Pi-owned provider authentication", () => {
  it("discovers providers and delegates login, refresh, and logout to Pi", async () => {
    const auth = await readFile("lib/provider-auth.ts", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(auth).toMatch(/runtime\s*\.getProviders\(\)/);
    expect(auth).toMatch(/runtime\s*\.login\(providerId, authType/);
    expect(auth).toContain("runtime.logout(providerId)");
    expect(runtime).toContain("ModelRuntime.create({ credentials: sqliteAgentCredentialStore })");
  });

  it("contains no provider callback ports, OAuth endpoints, or preferred provider IDs", async () => {
    const sources = await Promise.all([
      readFile("lib/provider-auth.ts", "utf8"),
      readFile("components/provider-auth-manager.tsx", "utf8"),
      readFile("compose.yaml", "utf8"),
    ]);
    const combined = sources.join("\n");
    expect(combined).not.toMatch(/1455|53692|PI_OAUTH_CALLBACK/);
    expect(combined).not.toMatch(/claude\.ai\/oauth|auth\.openai|openrouter\.ai\/auth/);
    expect(combined).not.toContain('provider.id === "openai-codex"');
  });

  it("persists credentials through a redacted Pi CredentialStore", async () => {
    const store = await readFile("lib/agent-credential-store.ts", "utf8");
    const database = await readFile("lib/database.ts", "utf8");
    expect(store).toContain("async modify(");
    expect(store).toContain("async delete(");
    expect(store).toContain("SELECT provider,auth_type FROM agent_credentials");
    expect(store).not.toContain("credential_json FROM agent_credentials ORDER BY provider");
    expect(database).toContain("credential_json TEXT NOT NULL DEFAULT ''");
  });

  it("exposes a generic prompt transport and a useful missing-provider error", async () => {
    const route = await readApiRoutes();
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    for (const endpoint of ["agent/auth/providers", "agent/auth/login"]) expect(route).toContain(endpoint);
    expect(runtime).toContain("Connect a model provider in Settings before starting an Agent conversation.");
  });

  it("shows the active model in chat and links its editor to Settings", async () => {
    const workspace = await readFile("components/workspace-client.tsx", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    const settings = await readFile("components/settings-client.tsx", "utf8");
    expect(workspace).toContain('navigateClient("/settings#agent")');
    expect(workspace).toContain('onClick={() => navigateClient("/settings#agent")}');
    expect(workspace).toContain("task-status-link");
    expect(workspace).toContain("agent-model-summary");
    expect(runtime).toContain("modelProvider: state.session.model?.provider");
    expect(settings).toContain('id="agent"');
  });
});
