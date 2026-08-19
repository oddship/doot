// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isProtectedMailbox, validateMailboxTarget } from "@/lib/imap-folder";
import { isGmailSystemLabel, mailboxNoun, providerForConnection, providerForHost } from "@/lib/mail-provider";

describe("mail provider profiles", () => {
  it("detects Gmail by host and the authoritative IMAP capability", () => {
    expect(providerForHost("imap.gmail.com")).toBe("gmail");
    expect(providerForHost("mail.example.com")).toBe("imap");
    expect(providerForConnection(new Map([["X-GM-EXT-1", true]]), "mail.example.com")).toBe("gmail");
  });

  it("recognizes both documented Gmail system-label roots", () => {
    expect(isGmailSystemLabel("[Gmail]/Trash")).toBe(true);
    expect(isGmailSystemLabel("[GoogleMail]/All Mail")).toBe(true);
    expect(isGmailSystemLabel("Receipts/Gmail")).toBe(false);
  });

  it("protects Gmail system labels even when Special-Use metadata is absent", () => {
    expect(isProtectedMailbox({ path: "[Gmail]/Important", flags: [] }, "gmail")).toBe(true);
    expect(() => validateMailboxTarget("[Gmail]/Custom", "gmail")).toThrow("reserved");
    expect(validateMailboxTarget("Agent/Receipts", "gmail")).toBe("Agent/Receipts");
  });

  it("uses provider-correct terminology", () => {
    expect(mailboxNoun("gmail")).toBe("label");
    expect(mailboxNoun("imap")).toBe("folder");
  });
});
