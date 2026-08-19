// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactSource } from "./source-contract";

describe("Agent memory management UI", () => {
  it("exposes namespace listing and KV CRUD through the local API", async () => {
    const route = await readFile("app/api/[...path]/route.ts", "utf8");
    expect(route).toContain('key === "agent/memory" && method === "GET"');
    expect(route).toContain('key === "agent/memory" && method === "PUT"');
    expect(route).toContain('key === "agent/memory" && method === "DELETE"');
    expect(route).toContain("Explicit confirmation is required");
  });

  it("renders the same namespaced JSON memory used by Agent tools", async () => {
    const settings = compactSource(await readFile("components/settings-client.tsx", "utf8"));
    const manager = compactSource(await readFile("components/memory-manager.tsx", "utf8"));
    expect(settings).toContain("<MemoryManager");
    expect(manager).toContain("Inspect and manage the namespaced JSON memory");
    expect(manager).toContain('apiJson( "/api/agent/memory"');
  });

  it("injects a key-only catalog once per conversation and retrieves values on demand", async () => {
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    const store = await readFile("lib/store.ts", "utf8");
    expect(runtime).toContain('name: "memory_namespaces"');
    expect(runtime).toContain('store<any>(["memory-context"])');
    expect(runtime).toContain("memoryInjected: boolean");
    expect(runtime).toContain("const includeMemoryCatalog = !state.memoryInjected");
    expect(runtime).toContain("Durable memory catalog (keys only");
    expect(runtime).toContain("Fetch a value only when relevant with memory_get");
    expect(store).toContain('case "memory-context"');
    expect(store).toContain("SELECT namespace,key,updated_at FROM agent_memory ORDER BY updated_at DESC LIMIT 20");
  });
});
