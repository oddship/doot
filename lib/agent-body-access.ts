import sanitizeHtml from "sanitize-html";
import { sanitizeMessageHtml } from "@/lib/mail";

export type BodyRef = { account: string; folder?: string; uid: string };
export const BODY_ACCESS_LIMITS = { approval: 50, batch: 5, perRun: 50, textChars: 6_000 };
export const bodyRefKey = (ref: BodyRef) => JSON.stringify([ref.account, ref.folder || "", ref.uid]);

export function approvedBodyBatch(
  selected: BodyRef[],
  input: { messages?: BodyRef[]; offset?: number; limit?: number },
) {
  const approved = selected.filter((ref) => ref.folder);
  const offset = input.offset ?? 0;
  const limit = input.limit ?? BODY_ACCESS_LIMITS.batch;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > BODY_ACCESS_LIMITS.batch
  )
    throw new Error("Read at most five approved bodies per call with a non-negative offset");
  const requested = input.messages;
  if (requested && (!Array.isArray(requested) || !requested.length || requested.length > BODY_ACCESS_LIMITS.batch))
    throw new Error("Supply between one and five exact approved references");
  const allowed = new Map(approved.map((ref) => [bodyRefKey(ref), ref]));
  const messages = requested
    ? requested.map((ref) => {
        if (!ref?.folder || !/^\d+$/.test(String(ref.uid)) || !allowed.has(bodyRefKey(ref)))
          throw new Error("Every requested body must first be selected or approved in the browser");
        return allowed.get(bodyRefKey(ref))!;
      })
    : approved.slice(offset, offset + limit);
  return {
    messages,
    approved_total: approved.length,
    next_offset: !requested && offset + limit < approved.length ? offset + limit : null,
  };
}

export function compactMessageBody(message: any, bodyOffset = 0) {
  if (!Number.isSafeInteger(bodyOffset) || bodyOffset < 0)
    throw new Error("Body excerpt offset must be a non-negative integer");
  const text = String(
    message.body_text ||
      sanitizeHtml(sanitizeMessageHtml(message.body_html || ""), { allowedTags: [], allowedAttributes: {} }),
  );
  return {
    account: message.account,
    uid: String(message.uid),
    folder: message.folder,
    sender: message.sender,
    subject: message.subject,
    date: message.date,
    body_text: text.slice(bodyOffset, bodyOffset + BODY_ACCESS_LIMITS.textChars),
    body_offset: bodyOffset,
    body_next_offset:
      bodyOffset + BODY_ACCESS_LIMITS.textChars < text.length ? bodyOffset + BODY_ACCESS_LIMITS.textChars : null,
    body_truncated: bodyOffset > 0 || text.length > BODY_ACCESS_LIMITS.textChars,
    body_chars_total: text.length,
    attachments: (Array.isArray(message.attachments) ? message.attachments : [])
      .slice(0, 20)
      .map((attachment: any) => ({
        filename: attachment.filename,
        contentType: attachment.contentType || attachment.content_type,
        size: attachment.size,
      })),
  };
}
