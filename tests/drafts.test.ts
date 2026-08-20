// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildDraftMime } from "@/lib/draft-mime";
import { readApiRoutes } from "./source-contract";

const content = {
  to: ["Maya <maya@example.com>"],
  cc: [],
  bcc: [],
  subject: "नमस्ते",
  body: "Hello\nworld",
  references: [],
};

describe("email drafts", () => {
  it("builds a UTF-8 MIME draft without leaking line endings into headers", () => {
    const mime = buildDraftMime({ username: "me@example.com" }, content);
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(Buffer.from(mime.split("\r\n\r\n")[1].trim(), "base64").toString()).toBe("Hello\nworld");
    expect(() => buildDraftMime({ username: "me@example.com\r\nBcc: bad@example.com" }, content)).toThrow(
      "invalid header",
    );
  });

  it("keeps IMAP persistence behind explicit confirmation and the Drafts special-use folder", async () => {
    const [route, imap, runtime] = await Promise.all([
      readApiRoutes(),
      readFile("lib/imap.ts", "utf8"),
      readFile("lib/agent-runtime.ts", "utf8"),
    ]);
    expect(route).toContain("Explicit confirmation is required to save a draft to IMAP");
    expect(imap).toContain('mailbox.specialUse === "\\\\Drafts"');
    expect(imap).toContain('["\\\\Draft"]');
    expect(runtime).toContain('name: "email_prepare_draft"');
    expect(runtime).toContain("never sends mail or writes to IMAP");
  });
});
