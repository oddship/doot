// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readApiRoutes } from "./source-contract";

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

  it("keeps the API entry point small and centralizes confirmation parsing", async () => {
    const entry = await readFile("app/api/[...path]/route.ts", "utf8");
    const routes = await readApiRoutes();
    expect(entry.split("\n").length).toBeLessThan(40);
    expect(entry).toContain("API_ROUTE_HANDLERS");
    expect(routes.match(/value\.confirm !== true/g)).toHaveLength(1);
  });

  it("composes global styles from bounded responsibility files", async () => {
    const globals = await readFile("app/globals.css", "utf8");
    const styles = (await readdir("app/styles")).filter((file) => file.endsWith(".css"));
    expect(globals.split("\n").length).toBeLessThan(30);
    expect(styles.length).toBeGreaterThan(8);
    for (const style of styles) expect(globals).toContain(`@import "./styles/${style}"`);
  });
});
