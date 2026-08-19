// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { compactSource } from "./source-contract";

describe("background sync contract", () => {
  it("passes one account separately from numeric sync options", async () => {
    const sync = compactSource(await readFile("lib/sync.ts", "utf8"));
    const store = await readFile("lib/store.ts", "utf8");
    expect(sync).toContain('"--account", account.name');
    expect(store).toContain('option(rest, "--account")');
    expect(store).not.toContain("rest.slice(accountIndex + 1)");
  });

  it("hydrates and reports completed and failed accounts", async () => {
    const client = await readFile("components/sync-button.tsx", "utf8");
    expect(client).toContain('apiJson<SyncJob>("/api/sync"');
    expect(client).toContain('account.status === "done" || account.status === "error"');
    expect(client).toContain("Sync failed");
  });
});
