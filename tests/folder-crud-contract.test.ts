// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { isProtectedMailbox, validateMailboxPath } from "@/lib/imap-folder";
import { readApiRoutes } from "./source-contract";

describe("first-class IMAP folder CRUD", () => {
  it("accepts Unicode paths and rejects empty, oversized, or controlled paths", () => {
    expect(validateMailboxPath("  ग्राहकों/महत्वपूर्ण  ")).toBe("ग्राहकों/महत्वपूर्ण");
    expect(() => validateMailboxPath("  ")).toThrow("required");
    expect(() => validateMailboxPath("bad\nfolder")).toThrow("control");
    expect(() => validateMailboxPath("x".repeat(513))).toThrow("too long");
  });

  it("protects Inbox, special-use, and non-selectable folders", () => {
    expect(isProtectedMailbox({ path: "INBOX" })).toBe(true);
    expect(isProtectedMailbox({ path: "Sent", specialUse: "\\Sent" })).toBe(true);
    expect(isProtectedMailbox({ path: "[Gmail]", flags: ["\\NoSelect"] })).toBe(true);
    expect(isProtectedMailbox({ path: "Agent/Receipts", flags: [] })).toBe(false);
  });

  it("uses ImapFlow CREATE, RENAME, and DELETE and refreshes discovery", async () => {
    const imap = await readFile("lib/imap.ts", "utf8");
    expect(imap).toContain("client.mailboxCreate");
    expect(imap).toContain("client.mailboxRename");
    expect(imap).toContain("client.mailboxDelete");
    expect(imap).toContain("cacheAccountFolders(account, result.folders)");
  });

  it("requires browser confirmation and keeps the Agent read-only", async () => {
    const route = await readApiRoutes();
    const client = await readFile("components/folder-manager.tsx", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    expect(route).toContain("Explicit confirmation is required for every IMAP folder write");
    expect(client).toContain("confirm: true");
    expect(runtime).not.toContain('name: "email_create_folder"');
  });

  it("retargets rules after rename and pauses them after deletion", async () => {
    const rules = await readFile("lib/rules.ts", "utf8");
    expect(rules).toContain("reconcileFolderRules");
    expect(rules).toContain("target_folder=?");
    expect(rules).toContain("enabled=0,status='paused'");
  });

  it("models Gmail labels separately and excludes system labels from rule targets", async () => {
    const imap = await readFile("lib/imap.ts", "utf8");
    const runtime = await readFile("lib/agent-runtime.ts", "utf8");
    const client = await readFile("components/folder-manager.tsx", "utf8");
    expect(imap).toContain("capabilities, account.host");
    expect(imap).toContain("rule_target_allowed");
    expect(runtime).toContain("rule_target_allowed=true");
    expect(client).toContain("Messages keep their other labels and remain in All Mail");
  });
});
