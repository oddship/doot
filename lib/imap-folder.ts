export type FolderMutation =
  | { action: "create"; path: string }
  | { action: "rename"; path: string; new_path: string }
  | { action: "delete"; path: string };

export function validateMailboxPath(value: unknown, field = "folder path") {
  if (typeof value !== "string") throw new Error(`${field} is required`);
  const path = value.trim();
  if (!path) throw new Error(`${field} is required`);
  if (new TextEncoder().encode(path).byteLength > 512) throw new Error(`${field} is too long`);
  if (/\p{Cc}/u.test(path)) throw new Error(`${field} contains control characters`);
  return path;
}

export function isProtectedMailbox(
  folder: { path: string; specialUse?: string | null; special_use?: string | null; flags?: Iterable<string> },
  provider: MailProvider = "imap",
) {
  const flags = [...(folder.flags || [])].map((flag) => flag.toLowerCase());
  return (
    folder.path.toLowerCase() === "inbox" ||
    Boolean(folder.specialUse || folder.special_use) ||
    flags.includes("\\noselect") ||
    (provider === "gmail" && isGmailSystemLabel(folder.path))
  );
}

export function validateMailboxTarget(value: unknown, provider: MailProvider, field = "folder path") {
  const path = validateMailboxPath(value, field);
  if (path.toLowerCase() === "inbox" || (provider === "gmail" && isGmailSystemLabel(path))) {
    throw new Error(provider === "gmail" ? "Gmail system labels are reserved" : "INBOX is a protected system folder");
  }
  return path;
}

import { isGmailSystemLabel, type MailProvider } from "@/lib/mail-provider";
