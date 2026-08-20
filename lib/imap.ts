import { type FetchMessageObject, ImapFlow, type ListResponse, type MessageAddressObject } from "imapflow";
import PostalMime from "postal-mime";
import { accountByName, dateTimestamp, db, now, type StoredAccount } from "@/lib/database";
import { buildDraftMime } from "@/lib/draft-mime";
import type { LocalDraftContent } from "@/lib/drafts";
import { type FolderMutation, isProtectedMailbox, validateMailboxPath, validateMailboxTarget } from "@/lib/imap-folder";
import { providerForConnection } from "@/lib/mail-provider";
import { planMailboxSync } from "@/lib/sync-selection";

const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

function clientFor(account: StoredAccount) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: Boolean(account.use_ssl),
    doSTARTTLS: account.use_ssl ? undefined : false,
    auth: { user: account.username, pass: account.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 120_000,
    maxLiteralSize: MAX_MESSAGE_BYTES + 1024 * 1024,
    maxResponseSize: MAX_MESSAGE_BYTES + 2 * 1024 * 1024,
    clientInfo: { name: "Doot", version: "1.0.0" },
  });
  // ImapFlow is an EventEmitter; consuming the error event prevents a socket
  // failure after a completed request from becoming an unhandled exception.
  client.on("error", () => {});
  return client;
}

async function withMailbox<T>(
  account: StoredAccount,
  folder: string,
  readOnly: boolean,
  callback: (client: ImapFlow) => Promise<T>,
) {
  const client = clientFor(account);
  await client.connect();
  const lock = await client.getMailboxLock(folder, {
    readOnly,
    description: readOnly ? "Doot read" : "Confirmed mailbox action",
  });
  try {
    return await callback(client);
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

async function withClient<T>(account: StoredAccount, callback: (client: ImapFlow) => Promise<T>) {
  const client = clientFor(account);
  await client.connect();
  try {
    return await callback(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export async function appendImapDraft(accountName: string, draft: LocalDraftContent) {
  const account = accountByName(accountName);
  if (!account) throw new Error("unknown account");
  return withClient(account, async (client) => {
    const listed = await client.list();
    const folder = listed.find((mailbox) => mailbox.specialUse === "\\Drafts")?.path;
    if (!folder) throw new Error("this IMAP server did not advertise a Drafts folder; discover or configure one first");
    const result = await client.append(folder, buildDraftMime(account, draft), ["\\Draft"]);
    if (result === false) throw new Error("the IMAP server rejected the draft");
    return {
      account: accountName,
      folder,
      uid: result.uid ? String(result.uid) : null,
      uid_validity: result.uidValidity?.toString() || null,
    };
  });
}

export async function discoverAccountFolders(name: string) {
  const account = accountByName(name);
  if (!account) throw new Error("unknown account");
  const result = await withClient(account, async (client) => {
    const provider = providerForConnection(client.capabilities, account.host);
    return { provider, folders: folderRows(account, await client.list(), provider) };
  });
  return { ...cacheAccountFolders(account, result.folders), provider: result.provider };
}

function folderRows(account: StoredAccount, listed: ListResponse[], provider: "gmail" | "imap") {
  return listed
    .map((folder) => ({
      account: account.name,
      path: folder.path,
      name: folder.name,
      delimiter: folder.delimiter || "/",
      parent_path: folder.parentPath || "",
      special_use: folder.specialUse || null,
      flags: [...folder.flags].sort(),
      subscribed: Boolean(folder.subscribed),
      provider,
      kind: provider === "gmail" ? "label" : "folder",
      protected: isProtectedMailbox(folder, provider),
      rule_target_allowed: !isProtectedMailbox(folder, provider),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function cacheAccountFolders(account: StoredAccount, folders: ReturnType<typeof folderRows>) {
  const discoveredAt = now();
  const insert =
    db.prepare(`INSERT INTO imap_folders(account,path,name,delimiter,parent_path,special_use,flags_json,subscribed,discovered_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    db.prepare("DELETE FROM imap_folders WHERE account=?").run(account.name);
    for (const folder of folders)
      insert.run(
        folder.account,
        folder.path,
        folder.name,
        folder.delimiter,
        folder.parent_path,
        folder.special_use,
        JSON.stringify(folder.flags),
        Number(folder.subscribed),
        discoveredAt,
      );
  })();
  return { account: account.name, email: account.username, folders, discovered_at: discoveredAt };
}

export async function mutateAccountFolder(name: string, mutation: FolderMutation) {
  const account = accountByName(name);
  if (!account) throw new Error("unknown account");
  const path = validateMailboxPath(mutation.path);
  const result = await withClient(account, async (client) => {
    const provider = providerForConnection(client.capabilities, account.host);
    const listed = await client.list();
    const current = listed.find((folder) => folder.path === path);
    let operation: { action: FolderMutation["action"]; path: string; new_path?: string };
    if (mutation.action === "create") {
      if (current) throw new Error("folder already exists");
      const target = validateMailboxTarget(path, provider);
      const created = await client.mailboxCreate(target);
      if (!created.created) throw new Error("folder already exists");
      operation = { action: mutation.action, path: created.path };
    } else {
      if (!current) throw new Error("folder no longer exists; discover folders again");
      if (isProtectedMailbox(current, provider))
        throw new Error(
          provider === "gmail"
            ? "Gmail system labels cannot be renamed or deleted"
            : "system and non-selectable folders cannot be renamed or deleted",
        );
      if (mutation.action === "rename") {
        const newPath = validateMailboxTarget(
          mutation.new_path,
          provider,
          provider === "gmail" ? "new label path" : "new folder path",
        );
        if (newPath === path) throw new Error("new folder path must be different");
        if (listed.some((folder) => folder.path === newPath)) throw new Error("destination folder already exists");
        const renamed = await client.mailboxRename(path, newPath);
        operation = { action: mutation.action, path: renamed.path, new_path: renamed.newPath };
      } else {
        const deleted = await client.mailboxDelete(path);
        operation = { action: mutation.action, path: deleted.path };
      }
    }
    return { operation, provider, folders: folderRows(account, await client.list(), provider) };
  });
  return { ...cacheAccountFolders(account, result.folders), provider: result.provider, operation: result.operation };
}

function sender(addresses?: MessageAddressObject[]) {
  const value = addresses?.[0];
  if (!value) return "";
  if (value.name && value.address) return `"${value.name.replaceAll('"', "")}" <${value.address}>`;
  return value.address || value.name || "";
}

function headerRow(message: FetchMessageObject) {
  const flags = [...(message.flags || [])];
  return {
    id: String(message.uid),
    sender: sender(message.envelope?.from || message.envelope?.sender),
    subject: message.envelope?.subject || "",
    date:
      message.envelope?.date?.toUTCString() ||
      (message.internalDate instanceof Date ? message.internalDate.toUTCString() : String(message.internalDate || "")),
    flags,
    unread: !flags.includes("\\Seen"),
  };
}

export async function testAccount(name: string) {
  const account = accountByName(name);
  if (!account) throw new Error("unknown account");
  return withMailbox(account, "INBOX", true, async () => ({ ok: true, account: name }));
}

export async function syncAccount(input: { name: string; days: number; limit: number; refresh?: boolean }) {
  const account = accountByName(input.name);
  if (!account) throw new Error("unknown account");
  const started = Date.now();
  const cached = db
    .prepare("SELECT COALESCE(MAX(CAST(uid AS INTEGER)),0) value FROM messages WHERE account=?")
    .get(account.name) as any;
  const cachedMax = Number(cached.value || 0);
  try {
    const result = await withMailbox(account, "INBOX", true, async (client) => {
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error("INBOX did not open");
      const currentValidity = mailbox.uidValidity.toString();
      const state = db.prepare("SELECT uid_validity FROM sync_state WHERE account=?").get(account.name) as any;
      const validityChanged = Boolean(state?.uid_validity && state.uid_validity !== currentValidity);
      const cutoff = new Date(Date.now() - Math.max(1, Math.min(input.days, 3650)) * 86400_000);
      const found = await client.search({ since: cutoff }, { uid: true });
      const cachedRows = db
        .prepare("SELECT uid,date_ts FROM messages WHERE account=? AND folder='INBOX'")
        .all(account.name) as Array<{ uid: string; date_ts: number }>;
      const cachedUids = new Set(validityChanged ? [] : cachedRows.map((row) => Number(row.uid)));
      const plan = planMailboxSync(Array.isArray(found) ? found.map(Number) : [], cachedUids, input.limit);
      const { eligible, desired: uids, missing, backfilled } = plan;
      // Refresh the desired set, not just new UIDs. This both fills historical
      // gaps and keeps read/unread flags accurate without downloading bodies.
      const fetched = uids.length
        ? await client.fetchAll(uids, { uid: true, envelope: true, internalDate: true, flags: true }, { uid: true })
        : [];
      const rows = fetched.map(headerRow).sort((a, b) => Number(b.id) - Number(a.id));
      const unseen = await client.search({ seen: false }, { uid: true });
      const timestamp = now();
      const insert =
        db.prepare(`INSERT INTO messages(account,account_email,uid,sender,subject,date,date_ts,flags_json,unread,present,fetched_at)
        VALUES(?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(account,uid) DO UPDATE SET
        account_email=excluded.account_email,sender=excluded.sender,subject=excluded.subject,
        date=excluded.date,date_ts=excluded.date_ts,flags_json=excluded.flags_json,
        unread=excluded.unread,present=1,fetched_at=excluded.fetched_at`);
      db.transaction(() => {
        if (validityChanged) db.prepare("DELETE FROM messages WHERE account=?").run(account.name);
        for (const row of rows)
          insert.run(
            account.name,
            account.username,
            row.id,
            row.sender,
            row.subject,
            row.date,
            dateTimestamp(row.date),
            JSON.stringify(row.flags),
            Number(row.unread),
            timestamp,
          );
        const live = new Set(eligible);
        const markAbsent = db.prepare("UPDATE messages SET present=0 WHERE account=? AND folder='INBOX' AND uid=?");
        for (const row of cachedRows)
          if (row.date_ts >= Math.floor(cutoff.getTime() / 1000) && !live.has(Number(row.uid)))
            markAbsent.run(account.name, row.uid);
        const newest = Math.max(...eligible, 0);
        db.prepare(`INSERT INTO sync_state(account,last_uid,last_sync,last_error,uid_validity,mailbox_messages,mailbox_unseen) VALUES(?,?,?,NULL,?,?,?)
          ON CONFLICT(account) DO UPDATE SET last_uid=excluded.last_uid,last_sync=excluded.last_sync,last_error=NULL,uid_validity=excluded.uid_validity,mailbox_messages=excluded.mailbox_messages,mailbox_unseen=excluded.mailbox_unseen`).run(
          account.name,
          newest,
          timestamp,
          currentValidity,
          mailbox.exists,
          Array.isArray(unseen) ? unseen.length : 0,
        );
      })();
      const cachedNow = Number(
        (db.prepare("SELECT COUNT(*) count FROM messages WHERE account=? AND present=1").get(account.name) as any)
          .count,
      );
      return {
        account: account.name,
        new: missing.length - backfilled,
        added: missing.length,
        backfilled,
        refreshed: rows.length - missing.length,
        cached: cachedNow,
        mailbox_messages: mailbox.exists,
        mailbox_unseen: Array.isArray(unseen) ? unseen.length : 0,
        uid_validity_changed: validityChanged,
      };
    });
    return { synced_at: now(), accounts: [result], errors: [], elapsed_ms: Date.now() - started };
  } catch (error: any) {
    const message = String(error?.message || error);
    db.prepare(`INSERT INTO sync_state(account,last_uid,last_sync,last_error) VALUES(?,?,?,?)
      ON CONFLICT(account) DO UPDATE SET last_sync=excluded.last_sync,last_error=excluded.last_error`).run(
      account.name,
      cachedMax,
      now(),
      message,
    );
    return {
      synced_at: now(),
      accounts: [],
      errors: [{ account: account.name, error: message }],
      elapsed_ms: Date.now() - started,
    };
  }
}

export async function readMessage(accountName: string, uid: string) {
  const account = accountByName(accountName);
  if (!account) throw new Error("unknown account");
  let existing = db
    .prepare("SELECT * FROM messages WHERE account=? AND uid=? AND present=1")
    .get(accountName, uid) as any;
  if (!existing) throw new Error("message is no longer available in Inbox");
  if (!existing.body_fetched) {
    const parsed = await withMailbox(account, existing.folder || "INBOX", true, async (client) => {
      const metadata = await client.fetchOne(uid, { uid: true, size: true }, { uid: true });
      if (!metadata) throw new Error("message not found upstream");
      if ((metadata.size || 0) > MAX_MESSAGE_BYTES) throw new Error("message exceeds the 25 MB safe reading limit");
      // ImapFlow maps source:true to BODY.PEEK[], so this read does not add \Seen.
      const message = await client.fetchOne(uid, { uid: true, source: true }, { uid: true });
      if (message === false || !message.source) throw new Error("message source was not returned upstream");
      return PostalMime.parse(message.source, {
        maxNestingDepth: 64,
        maxHeadersSize: 2 * 1024 * 1024,
        maxRfc822NestingDepth: 5,
      });
    });
    const attachments = (parsed.attachments || []).map((attachment) => ({
      filename: attachment.filename || "attachment",
      content_type: attachment.mimeType || "application/octet-stream",
      size:
        attachment.content instanceof ArrayBuffer
          ? attachment.content.byteLength
          : typeof attachment.content === "string"
            ? Buffer.byteLength(attachment.content)
            : 0,
    }));
    db.prepare(
      `UPDATE messages SET body_text=?,body_html=?,attachments_json=?,body_fetched=1,fetched_at=? WHERE account=? AND uid=?`,
    ).run(parsed.text || "", parsed.html || "", JSON.stringify(attachments), now(), accountName, uid);
    existing = db
      .prepare("SELECT * FROM messages WHERE account=? AND uid=? AND present=1")
      .get(accountName, uid) as any;
    if (!existing) throw new Error("message is no longer available in Inbox");
  }
  const value = { ...existing, attachments: JSON.parse(existing.attachments_json || "[]") };
  delete value.attachments_json;
  return value;
}

async function specialMailbox(client: ImapFlow, specialUse: string, fallback: string) {
  const listed = await client.list();
  return listed.find((mailbox) => mailbox.specialUse === specialUse)?.path || fallback;
}

function requireApplied(value: unknown, operation: string) {
  if (value === false) throw new Error(`${operation} was rejected by the IMAP server`);
}

export async function applyMailboxAction(
  action: "archive" | "move" | "delete",
  items: Array<{ account: string; uid: string; folder?: string }>,
) {
  const results: any[] = [],
    errors: any[] = [];
  const groups = new Map<string, typeof items>();
  for (const item of items) groups.set(item.account, [...(groups.get(item.account) || []), item]);
  for (const [accountName, accountItems] of groups) {
    const account = accountByName(accountName);
    if (!account) {
      errors.push(...accountItems.map((item) => ({ item, error: "unknown account" })));
      continue;
    }
    try {
      await withMailbox(account, "INBOX", false, async (client) => {
        if (action === "archive") {
          const uids = accountItems.map((item) => Number(item.uid));
          if (providerForConnection(client.capabilities, account.host) === "gmail")
            requireApplied(
              await client.messageFlagsRemove(uids, ["\\Inbox"], { uid: true, useLabels: true, silent: true }),
              "archive",
            );
          else
            requireApplied(
              await client.messageMove(uids, await specialMailbox(client, "\\Archive", "Archive"), { uid: true }),
              "archive",
            );
          results.push(...accountItems.map((item) => ({ account: accountName, uid: item.uid, ok: true })));
        } else if (action === "delete") {
          const uids = accountItems.map((item) => Number(item.uid));
          if (providerForConnection(client.capabilities, account.host) === "gmail")
            requireApplied(
              await client.messageMove(uids, await specialMailbox(client, "\\Trash", "[Gmail]/Trash"), { uid: true }),
              "delete",
            );
          else requireApplied(await client.messageDelete(uids, { uid: true }), "delete");
          results.push(...accountItems.map((item) => ({ account: accountName, uid: item.uid, ok: true })));
        } else {
          for (const item of accountItems) {
            if (!item.folder || !/^[\w .@+\-/]{1,100}$/.test(item.folder)) {
              errors.push({ item, error: "invalid destination folder" });
              continue;
            }
            requireApplied(await client.messageMove(Number(item.uid), item.folder, { uid: true }), "move");
            results.push({ account: accountName, uid: item.uid, ok: true });
          }
        }
      });
    } catch (error: any) {
      errors.push(...accountItems.map((item) => ({ item, error: String(error?.message || error) })));
    }
  }
  const hide = db.prepare("UPDATE messages SET present=0 WHERE account=? AND uid=?");
  db.transaction(() => {
    for (const result of results) hide.run(result.account, result.uid);
  })();
  return { status: errors.length ? "partial_failure" : "applied", results, errors };
}
