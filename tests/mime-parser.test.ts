// @vitest-environment node
import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";

const limits = { maxNestingDepth: 64, maxHeadersSize: 2 * 1024 * 1024, maxRfc822NestingDepth: 5 };

describe("patched MIME parser compatibility", () => {
  it("decodes body alternatives and attachment metadata used by the local cache", async () => {
    const source = [
      "From: Sender <sender@example.test>",
      "Subject: =?UTF-8?B?UmVjZWlwdA==?=",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your receipt",
      "--inner",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Your receipt</p>",
      "--inner--",
      "--outer",
      'Content-Type: text/plain; name="receipt.txt"',
      'Content-Disposition: attachment; filename="receipt.txt"',
      "Content-Transfer-Encoding: base64",
      "",
      "aGVsbG8=",
      "--outer--",
    ].join("\r\n");
    const parsed = await PostalMime.parse(Buffer.from(source), limits);
    expect(parsed.subject).toBe("Receipt");
    expect(parsed.text).toContain("Your receipt");
    expect(parsed.html).toContain("<p>Your receipt</p>");
    const attachment = parsed.attachments[0];
    expect(attachment.filename).toBe("receipt.txt");
    expect(attachment.mimeType).toBe("text/plain");
    expect(attachment.content).toBeInstanceOf(ArrayBuffer);
    expect((attachment.content as ArrayBuffer).byteLength).toBe(5);
  });

  it("handles repeated joinable RFC 2047 encoded header words", async () => {
    const count = 4096;
    const parsed = await PostalMime.parse(
      `Subject: ${Array(count).fill("=?UTF-8?B?YQ==?=").join(" ")}\r\nContent-Type: text/plain\r\n\r\nBody`,
      limits,
    );
    expect(parsed.subject).toBe("a".repeat(count));
    expect(parsed.text?.trim()).toBe("Body");
  });
});
