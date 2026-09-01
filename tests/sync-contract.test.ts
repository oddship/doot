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

  it("syncs in durable batches and records mailbox checkpoints", async () => {
    const imap = await readFile("lib/imap.ts", "utf8");
    const database = await readFile("lib/database.ts", "utf8");
    const sync = await readFile("lib/sync.ts", "utf8");
    expect(imap).toContain("uidBatches(missing)");
    expect(imap).toContain("changedSince");
    expect(imap).toContain("checkpointMatches(state, snapshot");
    expect(imap).toContain("labels_json");
    expect(database).toContain("highest_modseq TEXT");
    expect(database).toContain("sync_days INTEGER");
    expect(database).toContain("sync_limit INTEGER");
    expect(database).toContain("PRIMARY KEY(account,folder,uid)");
    expect(database).toContain("PRIMARY KEY(account,folder)");
    expect(imap).toContain("selectSyncFolders");
    expect(sync).toContain('"--scope"');
    expect(sync).toContain('"--folders"');
  });

  it("supports syncing every message inside the configured lookback", async () => {
    const settings = await readFile("components/settings-client.tsx", "utf8");
    const store = await readFile("lib/store.ts", "utf8");
    expect(settings).toContain('<option value="all">All within lookback</option>');
    expect(store).toContain('requestedLimit === "all" ? 0');
    expect(store).toContain('value === "all" ? "all"');
  });
});
