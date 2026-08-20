import { randomUUID } from "node:crypto";

export type DraftMimeInput = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  in_reply_to?: string;
  references: string[];
};

function safeHeader(value: string) {
  if (/[\r\n]/.test(value)) throw new Error("draft contains an invalid header value");
  return value.trim();
}

function encodedHeader(value: string) {
  const safe = safeHeader(value);
  return /^[\x20-\x7E]*$/.test(safe) ? safe : `=?UTF-8?B?${Buffer.from(safe).toString("base64")}?=`;
}

function wrapBase64(value: string) {
  return (
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") || ""
  );
}

export function buildDraftMime(account: { username: string }, draft: DraftMimeInput) {
  const headers = [
    `From: ${safeHeader(account.username)}`,
    `To: ${draft.to.map(safeHeader).join(", ")}`,
    ...(draft.cc.length ? [`Cc: ${draft.cc.map(safeHeader).join(", ")}`] : []),
    ...(draft.bcc.length ? [`Bcc: ${draft.bcc.map(safeHeader).join(", ")}`] : []),
    `Subject: ${encodedHeader(draft.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@doot.local>`,
    ...(draft.in_reply_to ? [`In-Reply-To: ${safeHeader(draft.in_reply_to)}`] : []),
    ...(draft.references.length ? [`References: ${draft.references.map(safeHeader).join(" ")}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrapBase64(draft.body)}\r\n`;
}
