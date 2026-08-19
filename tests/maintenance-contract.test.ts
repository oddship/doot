// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("maintenance boundaries", () => {
  it("keeps rule persistence outside the command router", async () => {
    const store = await readFile("lib/store.ts", "utf8");
    const rules = await readFile("lib/rules.ts", "utf8");
    expect(store).toContain('from "@/lib/rules"');
    expect(store).not.toContain("function saveRule");
    expect(rules).toContain("export function saveRule");
  });

  it("centralizes browser JSON request behavior", async () => {
    const settings = await readFile("components/settings-client.tsx", "utf8");
    const memory = await readFile("components/memory-manager.tsx", "utf8");
    const inbox = await readFile("components/inbox-client.tsx", "utf8");
    for (const source of [settings, memory, inbox]) expect(source).toContain("apiJson");
  });

  it("centralizes confirmation parsing in the API route", async () => {
    const route = await readFile("app/api/[...path]/route.ts", "utf8");
    expect(route).toContain("confirmedBody");
    expect(route.match(/value\.confirm !== true/g)).toHaveLength(1);
  });
});
