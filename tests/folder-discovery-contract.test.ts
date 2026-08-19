// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("IMAP folder discovery", () => {
  it("uses read-only LIST and caches exact hierarchy paths", async () => {
    const imap = await readFile("lib/imap.ts", "utf8");
    const database = await readFile("lib/database.ts", "utf8");
    expect(imap).toContain("discoverAccountFolders");
    expect(imap).toContain("await client.list()");
    expect(database).toContain("CREATE TABLE IF NOT EXISTS imap_folders");
  });

  it("exposes folders to Settings and the Agent", async () => {
    const settings = await readFile("components/settings-client.tsx", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(settings).toContain("<FolderManager");
    expect(runtime).toContain('name: "email_list_folders"');
    expect(runtime).toContain("Never invent, translate, or assume paths");
  });

  it("rejects undiscovered or non-selectable move destinations", async () => {
    const rules = await readFile("lib/rules.ts", "utf8");
    expect(rules).toContain("knownMoveDestination");
    expect(rules).toContain("selectable folder");
  });
});
