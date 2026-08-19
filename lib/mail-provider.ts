export type MailProvider = "gmail" | "imap";

export function providerForHost(host: string): MailProvider {
  const normalized = host.trim().toLowerCase();
  return normalized === "imap.gmail.com" || normalized.endsWith(".gmail.com") || normalized.endsWith(".googlemail.com")
    ? "gmail"
    : "imap";
}

export function providerForConnection(capabilities: Pick<Map<string, unknown>, "has">, host: string): MailProvider {
  return capabilities.has("X-GM-EXT-1") ? "gmail" : providerForHost(host);
}

export function isGmailSystemLabel(path: string) {
  const root = path.trim().split("/", 1)[0].toLowerCase();
  return root === "[gmail]" || root === "[googlemail]";
}

export function mailboxNoun(provider: MailProvider) {
  return provider === "gmail" ? "label" : "folder";
}
