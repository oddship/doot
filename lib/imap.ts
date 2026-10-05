import { type FetchMessageObject, ImapFlow, type ListResponse, type MessageAddressObject } from "imapflow";
import PostalMime from "postal-mime";
import { accountByName, dateTimestamp, db, json, now, type StoredAccount } from "@/lib/database";
import { buildDraftMime } from "@/lib/draft-mime";
import type { LocalDraftContent } from "@/lib/drafts";
import { type BodyFetchMetrics, fetchBodyBatches, MAX_MESSAGE_BYTES } from "@/lib/imap-body-read";
import { type FolderMutation, isProtectedMailbox, validateMailboxPath, validateMailboxTarget } from "@/lib/imap-folder";
import { withImapRetry } from "@/lib/imap-retry";
import {
  cacheWindowNeedsRefresh,
  checkpointMatches,
  normalizeSyncWindow,
  planFlagRefresh,
  type SyncScope,
  selectSyncFolders,
  uidBatches,
} from "@/lib/imap-sync";
import { providerForConnection, providerForHost } from "@/lib/mail-provider";
import { planMailboxSync } from "@/lib/sync-selection";

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
  metrics?: ReadMailboxMetrics,
) {
  const client = clientFor(account);
  let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | undefined;
  try {
    const connectStarted = performance.now();
    await client.connect();
    if (metrics) metrics.connect_ms += performance.now() - connectStarted;
    const mailboxStarted = performance.now();
    lock = await client.getMailboxLock(folder, {
      readOnly,
      description: readOnly ? "Doot read" : "Confirmed mailbox action",
    });
    if (metrics) metrics.mailbox_ms += performance.now() - mailboxStarted;
    return await callback(client);
  } finally {
    lock?.release();
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

const READ_SESSION_IDLE_MS = 10 * 60_000;
const MAX_READ_SESSIONS = 12;

type ReadSession = {
  key: string;
  account: string;
  folder: string;
  client?: ImapFlow;
  broken: boolean;
  pending: number;
  lastUsed: number;
  queue: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const readSessions = new Map<string, ReadSession>();
const warmOperations = new Map<string, Promise<{ ok: boolean; account: string; warm: boolean }>>();

async function closeReadSession(session: ReadSession, graceful: boolean) {
  const client = session.client;
  session.client = undefined;
  session.broken = false;
  if (!client) return;
  if (!graceful) {
    client.close();
    return;
  }
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

function retireReadSession(session: ReadSession) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  if (readSessions.get(session.key) === session) readSessions.delete(session.key);
  void closeReadSession(session, true);
}

function scheduleReadSessionIdleClose(session: ReadSession) {
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const remaining = Math.max(1, READ_SESSION_IDLE_MS - (Date.now() - session.lastUsed));
  session.idleTimer = setTimeout(() => {
    if (session.pending !== 0) return;
    if (Date.now() - session.lastUsed >= READ_SESSION_IDLE_MS) retireReadSession(session);
    else scheduleReadSessionIdleClose(session);
  }, remaining);
  session.idleTimer.unref?.();
}

function readSessionFor(account: StoredAccount, folder: string) {
  const key = `${account.name}\n${folder}`;
  const current = readSessions.get(key);
  if (current) return current;
  if (readSessions.size >= MAX_READ_SESSIONS) {
    const oldestIdle = [...readSessions.values()]
      .filter((session) => session.pending === 0)
      .sort((left, right) => left.lastUsed - right.lastUsed)[0];
    if (!oldestIdle) return null;
    retireReadSession(oldestIdle);
  }
  const session: ReadSession = {
    key,
    account: account.name,
    folder,
    broken: false,
    pending: 0,
    lastUsed: Date.now(),
    queue: Promise.resolve(),
  };
  readSessions.set(key, session);
  return session;
}

async function connectReadSession(session: ReadSession, account: StoredAccount) {
  if (session.client && !session.broken) return session.client;
  if (session.client) await closeReadSession(session, false);
  const client = clientFor(account);
  session.client = client;
  session.broken = false;
  client.on("error", () => {
    if (session.client === client) session.broken = true;
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await closeReadSession(session, false);
    throw error;
  }
}

type ReadMailboxMetrics = { queue_ms: number; connect_ms: number; mailbox_ms: number };

async function withReusableReadMailbox<T>(
  account: StoredAccount,
  folder: string,
  callback: (client: ImapFlow) => Promise<T>,
  metrics?: ReadMailboxMetrics,
) {
  const session = readSessionFor(account, folder);
  if (!session) return withMailbox(account, folder, true, callback, metrics);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.pending += 1;
  const queuedAt = performance.now();
  const operation = session.queue.then(async () => {
    if (metrics) metrics.queue_ms += performance.now() - queuedAt;
    const connectStarted = performance.now();
    const client = await connectReadSession(session, account);
    if (metrics) metrics.connect_ms += performance.now() - connectStarted;
    let lock: Awaited<ReturnType<ImapFlow["getMailboxLock"]>> | undefined;
    let failed = false;
    try {
      const mailboxStarted = performance.now();
      lock = await client.getMailboxLock(folder, { readOnly: true, description: "Doot reusable read" });
      if (metrics) metrics.mailbox_ms += performance.now() - mailboxStarted;
      return await callback(client);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      lock?.release();
      if (failed || session.broken) await closeReadSession(session, false);
    }
  });
  session.queue = operation.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await operation;
  } finally {
    session.pending -= 1;
    session.lastUsed = Date.now();
    if (session.pending === 0 && readSessions.get(session.key) === session) scheduleReadSessionIdleClose(session);
  }
}

export async function warmMessageReader(accountName: string) {
  const pending = warmOperations.get(accountName);
  if (pending) return pending;
  const account = accountByName(accountName);
  if (!account) throw new Error("unknown account");
  const operation = withReusableReadMailbox(account, "INBOX", async () => ({
    ok: true,
    account: accountName,
    warm: true,
  }));
  warmOperations.set(accountName, operation);
  void operation.then(
    () => warmOperations.delete(accountName),
    () => warmOperations.delete(accountName),
  );
  return operation;
}

export async function closeAccountReadSessions(accountName: string) {
  const sessions = [...readSessions.values()].filter((session) => session.account === accountName);
  for (const session of sessions) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (readSessions.get(session.key) === session) readSessions.delete(session.key);
  }
  await Promise.all(sessions.map((session) => session.queue.then(() => closeReadSession(session, true))));
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
    labels: [...(message.labels || [])],
    providerId: message.emailId || "",
    unread: !flags.includes("\\Seen"),
  };
}

export async function testAccount(name: string) {
  const account = accountByName(name);
  if (!account) throw new Error("unknown account");
  return withMailbox(account, "INBOX", true, async () => ({ ok: true, account: name }));
}

async function syncFolder(input: { name: string; folder: string; days: number; limit: number; refresh?: boolean }) {
  const account = accountByName(input.name);
  if (!account) throw new Error("unknown account");
  const started = Date.now();
  const window = normalizeSyncWindow(input.days, input.limit);
  let retryCount = 0;
  try {
    const result = await withImapRetry(
      () =>
        withMailbox(account, input.folder, true, async (client) => {
          const mailbox = client.mailbox;
          if (!mailbox) throw new Error(`${input.folder} did not open`);
          const snapshot = {
            uidValidity: mailbox.uidValidity.toString(),
            uidNext: Number(mailbox.uidNext || 0),
            highestModseq: mailbox.highestModseq?.toString() || null,
            messages: Number(mailbox.exists || 0),
          };
          const cutoff = new Date(Date.now() - window.days * 86400_000);
          const cutoffTimestamp = Math.floor(cutoff.getTime() / 1000);
          let state = db
            .prepare("SELECT * FROM sync_state WHERE account=? AND folder=?")
            .get(account.name, input.folder) as any;
          const supportsStableIds = client.capabilities.has("X-GM-EXT-1") || client.capabilities.has("OBJECTID");
          const identityBackfill =
            window.limit === 0
              ? db
                  .prepare(
                    "SELECT COUNT(*) count FROM messages WHERE account=? AND folder=? AND present=1 AND provider_id=''",
                  )
                  .get(account.name, input.folder)
              : db
                  .prepare(
                    `SELECT COUNT(*) count FROM (
                      SELECT provider_id FROM messages WHERE account=? AND folder=? AND present=1
                      ORDER BY CAST(uid AS INTEGER) DESC LIMIT ?
                    ) WHERE provider_id=''`,
                  )
                  .get(account.name, input.folder, window.limit);
          const needsIdentityBackfill = supportsStableIds && Number((identityBackfill as { count: number }).count) > 0;
          const activeStats = db
            .prepare(`SELECT COUNT(*) count,
              SUM(CASE WHEN date_ts<? THEN 1 ELSE 0 END) outside_lookback
              FROM messages WHERE account=? AND folder=? AND present=1`)
            .get(cutoffTimestamp, account.name, input.folder) as { count: number; outside_lookback: number | null };
          const activeWindowMismatch = cacheWindowNeedsRefresh(
            { active: activeStats.count, outsideLookback: activeStats.outside_lookback },
            window,
          );
          const validityChanged = Boolean(state?.uid_validity && state.uid_validity !== snapshot.uidValidity);
          if (validityChanged) {
            const resetAt = now();
            db.transaction(() => {
              db.prepare("DELETE FROM messages WHERE account=? AND folder=?").run(account.name, input.folder);
              db.prepare(`INSERT INTO sync_state(account,folder,last_uid,last_sync,last_error,uid_validity,uid_next,highest_modseq,mailbox_messages,mailbox_unseen,sync_days,sync_limit)
                VALUES(?,?,0,?,NULL,?,?,NULL,?,NULL,?,?) ON CONFLICT(account,folder) DO UPDATE SET
                last_uid=0,last_sync=excluded.last_sync,last_error=NULL,uid_validity=excluded.uid_validity,
                uid_next=excluded.uid_next,highest_modseq=NULL,mailbox_messages=excluded.mailbox_messages,
                mailbox_unseen=NULL,sync_days=excluded.sync_days,sync_limit=excluded.sync_limit`).run(
                account.name,
                input.folder,
                resetAt,
                snapshot.uidValidity,
                snapshot.uidNext,
                snapshot.messages,
                window.days,
                window.limit,
              );
            })();
            state = db
              .prepare("SELECT * FROM sync_state WHERE account=? AND folder=?")
              .get(account.name, input.folder) as any;
          }

          if (
            checkpointMatches(state, snapshot, window, input.refresh) &&
            !needsIdentityBackfill &&
            !activeWindowMismatch
          ) {
            const timestamp = now();
            db.prepare("UPDATE sync_state SET last_sync=?,last_error=NULL WHERE account=? AND folder=?").run(
              timestamp,
              account.name,
              input.folder,
            );
            const cachedNow = Number(
              (
                db
                  .prepare("SELECT COUNT(*) count FROM messages WHERE account=? AND folder=? AND present=1")
                  .get(account.name, input.folder) as any
              ).count,
            );
            return {
              account: account.name,
              folder: input.folder,
              new: 0,
              added: 0,
              backfilled: 0,
              refreshed: 0,
              cached: cachedNow,
              mailbox_messages: snapshot.messages,
              mailbox_unseen: Number(state.mailbox_unseen || 0),
              uid_validity_changed: false,
              strategy: "checkpoint",
              batches: 0,
            };
          }

          const found = await client.search({ since: cutoff }, { uid: true });
          const cachedRows = db
            .prepare("SELECT uid FROM messages WHERE account=? AND folder=?")
            .all(account.name, input.folder) as Array<{ uid: string }>;
          const cachedUids = new Set(cachedRows.map((row) => Number(row.uid)));
          const cachedMax = Math.max(...cachedUids, 0);
          const plan = planMailboxSync(Array.isArray(found) ? found.map(Number) : [], cachedUids, window.limit);
          const { eligible, desired, missing } = plan;
          const insert =
            db.prepare(`INSERT INTO messages(account,account_email,uid,folder,sender,subject,date,date_ts,flags_json,labels_json,provider_id,unread,present,fetched_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(account,folder,uid) DO UPDATE SET
            account_email=excluded.account_email,sender=excluded.sender,subject=excluded.subject,
            date=excluded.date,date_ts=excluded.date_ts,flags_json=excluded.flags_json,labels_json=excluded.labels_json,
            provider_id=excluded.provider_id,unread=excluded.unread,present=1,fetched_at=excluded.fetched_at`);
          const updateFlags = db.prepare(`UPDATE messages SET flags_json=?,labels_json=?,unread=?,present=1,fetched_at=?
            ,provider_id=? WHERE account=? AND folder=? AND uid=?`);
          const reusableBody = db.prepare(`SELECT body_text,body_html,attachments_json FROM messages
            WHERE account=? AND provider_id=? AND body_fetched=1 AND NOT(folder=? AND uid=?) LIMIT 1`);
          const restoreBody = db.prepare(`UPDATE messages SET body_text=?,body_html=?,attachments_json=?,body_fetched=1
            WHERE account=? AND folder=? AND uid=? AND body_fetched=0`);
          const fetchedHeaderUids: number[] = [];
          let refreshed = 0;
          let batches = 0;

          for (const batch of uidBatches(missing)) {
            const fetched = await client.fetchAll(
              batch,
              { uid: true, envelope: true, internalDate: true, flags: true, labels: true },
              { uid: true },
            );
            const rows = fetched.map(headerRow);
            const timestamp = now();
            db.transaction(() => {
              for (const row of rows) {
                insert.run(
                  account.name,
                  account.username,
                  row.id,
                  input.folder,
                  row.sender,
                  row.subject,
                  row.date,
                  dateTimestamp(row.date),
                  JSON.stringify(row.flags),
                  JSON.stringify(row.labels),
                  row.providerId,
                  Number(row.unread),
                  timestamp,
                );
                if (row.providerId) {
                  const source = reusableBody.get(account.name, row.providerId, input.folder, row.id) as
                    | { body_text: string; body_html: string; attachments_json: string }
                    | undefined;
                  if (source)
                    restoreBody.run(
                      source.body_text,
                      source.body_html,
                      source.attachments_json,
                      account.name,
                      input.folder,
                      row.id,
                    );
                }
              }
            })();
            fetchedHeaderUids.push(...rows.map((row) => Number(row.id)));
            batches += 1;
          }

          const flagPlan = planFlagRefresh({
            desiredUids: desired,
            cachedPresentUids: desired.filter((uid) => cachedUids.has(uid)),
            supportsCondstore: client.enabled.has("CONDSTORE") && !mailbox.noModseq,
            previousHighestModseq: state?.highest_modseq,
            currentHighestModseq: snapshot.highestModseq,
            forceRefresh: input.refresh || needsIdentityBackfill,
          });
          const changedSince =
            flagPlan.changedSince && /^\d+$/.test(flagPlan.changedSince) ? BigInt(flagPlan.changedSince) : undefined;
          for (const batch of uidBatches(flagPlan.uids)) {
            const fetched = await client.fetchAll(
              batch,
              { uid: true, flags: true, labels: true },
              { uid: true, ...(changedSince ? { changedSince } : {}) },
            );
            const timestamp = now();
            db.transaction(() => {
              for (const message of fetched) {
                const flags = [...(message.flags || [])];
                updateFlags.run(
                  JSON.stringify(flags),
                  JSON.stringify([...(message.labels || [])]),
                  Number(!flags.includes("\\Seen")),
                  timestamp,
                  message.emailId || "",
                  account.name,
                  input.folder,
                  String(message.uid),
                );
              }
            })();
            refreshed += fetched.length;
            batches += 1;
          }

          const unseen = await client.search({ seen: false }, { uid: true });
          const timestamp = now();
          db.transaction(() => {
            db.prepare("UPDATE messages SET present=0 WHERE account=? AND folder=?").run(account.name, input.folder);
            for (const batch of uidBatches(desired, 900)) {
              const placeholders = batch.map(() => "?").join(",");
              db.prepare(`UPDATE messages SET present=1 WHERE account=? AND folder=? AND uid IN (${placeholders})`).run(
                account.name,
                input.folder,
                ...batch.map(String),
              );
            }
            const newest = Math.max(...eligible, 0);
            db.prepare(`INSERT INTO sync_state(account,folder,last_uid,last_sync,last_error,uid_validity,uid_next,highest_modseq,mailbox_messages,mailbox_unseen,sync_days,sync_limit)
              VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?) ON CONFLICT(account,folder) DO UPDATE SET
              last_uid=excluded.last_uid,last_sync=excluded.last_sync,last_error=NULL,
              uid_validity=excluded.uid_validity,uid_next=excluded.uid_next,highest_modseq=excluded.highest_modseq,
              mailbox_messages=excluded.mailbox_messages,mailbox_unseen=excluded.mailbox_unseen,
              sync_days=excluded.sync_days,sync_limit=excluded.sync_limit`).run(
              account.name,
              input.folder,
              newest,
              timestamp,
              snapshot.uidValidity,
              snapshot.uidNext,
              snapshot.highestModseq,
              snapshot.messages,
              Array.isArray(unseen) ? unseen.length : 0,
              window.days,
              window.limit,
            );
          })();
          const cachedNow = Number(
            (
              db
                .prepare("SELECT COUNT(*) count FROM messages WHERE account=? AND folder=? AND present=1")
                .get(account.name, input.folder) as any
            ).count,
          );
          const backfilled = fetchedHeaderUids.filter((uid) => uid <= cachedMax).length;
          return {
            account: account.name,
            folder: input.folder,
            new: fetchedHeaderUids.length - backfilled,
            added: fetchedHeaderUids.length,
            backfilled,
            refreshed,
            cached: cachedNow,
            mailbox_messages: snapshot.messages,
            mailbox_unseen: Array.isArray(unseen) ? unseen.length : 0,
            uid_validity_changed: validityChanged,
            strategy: flagPlan.strategy === "condstore" ? "incremental-condstore" : "bounded-refresh",
            batches,
          };
        }),
      { onRetry: () => (retryCount += 1) },
    );
    return {
      synced_at: now(),
      accounts: [{ ...result, retry_count: retryCount }],
      errors: [],
      elapsed_ms: Date.now() - started,
    };
  } catch (error: any) {
    const message = String(error?.message || error);
    const cached = db
      .prepare("SELECT COALESCE(MAX(CAST(uid AS INTEGER)),0) value FROM messages WHERE account=? AND folder=?")
      .get(account.name, input.folder) as any;
    db.prepare(`INSERT INTO sync_state(account,folder,last_uid,last_sync,last_error) VALUES(?,?,?,?,?)
      ON CONFLICT(account,folder) DO UPDATE SET last_sync=excluded.last_sync,last_error=excluded.last_error`).run(
      account.name,
      input.folder,
      Number(cached.value || 0),
      now(),
      message,
    );
    return {
      synced_at: now(),
      accounts: [],
      errors: [{ account: account.name, folder: input.folder, error: message, retry_count: retryCount }],
      elapsed_ms: Date.now() - started,
    };
  }
}

export async function syncAccount(input: {
  name: string;
  days: number;
  limit: number;
  refresh?: boolean;
  scope?: SyncScope;
  folders?: string[];
}) {
  const started = Date.now();
  const account = accountByName(input.name);
  if (!account) throw new Error("unknown account");
  try {
    const cachedFolders = (
      db
        .prepare("SELECT path,special_use,flags_json FROM imap_folders WHERE account=? ORDER BY path")
        .all(account.name) as Array<{ path: string; special_use?: string | null; flags_json: string }>
    ).map((folder) => ({ ...folder, flags: json<string[]>(folder.flags_json, []) }));
    const discovery = cachedFolders.length
      ? { folders: cachedFolders, provider: providerForHost(account.host) }
      : await discoverAccountFolders(account.name);
    const selected = selectSyncFolders(
      discovery.folders,
      discovery.provider,
      input.scope || "inbox",
      input.folders || [],
    );
    if (!selected.length) throw new Error("no selectable IMAP folders are available for this sync scope");
    const reports = [];
    for (const folder of selected)
      reports.push(
        await syncFolder({
          name: account.name,
          folder: folder.path,
          days: input.days,
          limit: input.limit,
          refresh: input.refresh,
        }),
      );
    const errors = reports.flatMap((report) => report.errors || []);
    if (!errors.length) {
      const paths = selected.map((folder) => folder.path);
      const placeholders = paths.map(() => "?").join(",");
      db.prepare(`UPDATE messages SET present=0 WHERE account=? AND folder NOT IN (${placeholders})`).run(
        account.name,
        ...paths,
      );
      db.prepare(`UPDATE sync_state SET highest_modseq=NULL WHERE account=? AND folder NOT IN (${placeholders})`).run(
        account.name,
        ...paths,
      );
    }
    const folderResults = reports.flatMap((report) => report.accounts || []);
    const cached = Number(
      (db.prepare("SELECT COUNT(*) count FROM messages WHERE account=? AND present=1").get(account.name) as any).count,
    );
    return {
      synced_at: now(),
      accounts: folderResults.length
        ? [
            {
              account: account.name,
              folders: folderResults,
              synced_folders: selected.map((folder) => folder.path),
              new: folderResults.reduce((sum, result) => sum + Number(result.new || 0), 0),
              added: folderResults.reduce((sum, result) => sum + Number(result.added || 0), 0),
              backfilled: folderResults.reduce((sum, result) => sum + Number(result.backfilled || 0), 0),
              refreshed: folderResults.reduce((sum, result) => sum + Number(result.refreshed || 0), 0),
              cached,
              mailbox_messages: folderResults.reduce((sum, result) => sum + Number(result.mailbox_messages || 0), 0),
              mailbox_unseen: folderResults.reduce((sum, result) => sum + Number(result.mailbox_unseen || 0), 0),
              strategy: folderResults.length === 1 ? folderResults[0].strategy : "multi-folder",
              batches: folderResults.reduce((sum, result) => sum + Number(result.batches || 0), 0),
              retry_count: folderResults.reduce((sum, result) => sum + Number(result.retry_count || 0), 0),
            },
          ]
        : [],
      errors,
      elapsed_ms: Date.now() - started,
    };
  } catch (error: any) {
    return {
      synced_at: now(),
      accounts: [],
      errors: [{ account: account.name, error: String(error?.message || error) }],
      elapsed_ms: Date.now() - started,
    };
  }
}

export type MessageBodyRef = { account: string; folder: string; uid: string };
export type BodyReadMetrics = BodyFetchMetrics &
  ReadMailboxMetrics & {
    requested: number;
    cache_hits: number;
    coalesced: number;
    network_messages: number;
    cache_ms: number;
    parse_ms: number;
    total_ms: number;
  };
const pendingBodyReads = new Map<string, Promise<void>>();
const bodyKey = (ref: MessageBodyRef) => JSON.stringify([ref.account, ref.folder, ref.uid]);

export async function readMessages(refs: MessageBodyRef[]) {
  if (!Array.isArray(refs) || refs.length > 50) throw new Error("Read at most 50 exact message references");
  const started = performance.now();
  const metrics: BodyReadMetrics = {
    requested: refs.length,
    cache_hits: 0,
    coalesced: 0,
    network_messages: 0,
    metadata_fetches: 0,
    source_fetches: 0,
    source_bytes: 0,
    metadata_ms: 0,
    source_ms: 0,
    queue_ms: 0,
    connect_ms: 0,
    mailbox_ms: 0,
    cache_ms: 0,
    parse_ms: 0,
    total_ms: 0,
  };
  const lookupStarted = performance.now();
  const find = db.prepare("SELECT * FROM messages WHERE account=? AND folder=? AND uid=? AND present=1");
  const lookup = db.prepare("SELECT body_fetched FROM messages WHERE account=? AND folder=? AND uid=? AND present=1");
  const cached = new Map<string, boolean>();
  const accounts = new Map<string, StoredAccount>();
  const unique = new Map<string, MessageBodyRef>();
  // Validate the entire input against the cache before starting any IMAP work.
  for (const ref of refs) {
    if (
      !ref?.account ||
      !ref.folder ||
      !/^\d+$/.test(String(ref.uid)) ||
      Number(ref.uid) < 1 ||
      Number(ref.uid) > 0xffffffff
    )
      throw new Error("Every body read requires an exact account, folder, and valid UID");
    if (!accounts.has(ref.account)) {
      const account = accountByName(ref.account);
      if (!account) throw new Error("unknown account");
      accounts.set(ref.account, account);
    }
    const key = bodyKey(ref);
    if (unique.has(key)) continue;
    const row = lookup.get(ref.account, ref.folder, ref.uid) as any;
    if (!row) throw new Error("message is no longer available in the synced mailbox cache");
    unique.set(key, ref);
    cached.set(key, Boolean(row.body_fetched));
  }
  const groups = new Map<string, MessageBodyRef[]>();
  const waits: Promise<void>[] = [];
  for (const [key, ref] of unique) {
    if (cached.get(key)) {
      metrics.cache_hits++;
      continue;
    }
    const pending = pendingBodyReads.get(key);
    if (pending) {
      metrics.coalesced++;
      waits.push(pending);
      continue;
    }
    const groupKey = JSON.stringify([ref.account, ref.folder]);
    const group = groups.get(groupKey) || [];
    group.push(ref);
    groups.set(groupKey, group);
  }
  metrics.cache_ms += performance.now() - lookupStarted;
  const update = db.prepare(`UPDATE messages SET body_text=?,body_html=?,attachments_json=?,body_fetched=1,fetched_at=?
    WHERE account=? AND folder=? AND uid=? AND present=1`);
  const jobs: Array<() => Promise<void>> = [];
  for (const group of groups.values()) {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const completion = new Promise<void>((ok, fail) => {
      resolve = ok;
      reject = fail;
    });
    waits.push(completion);
    for (const ref of group) pendingBodyReads.set(bodyKey(ref), completion);
    jobs.push(async () => {
      try {
        const { account, folder } = group[0];
        await withReusableReadMailbox(
          accounts.get(account)!,
          folder,
          async (client) => {
            const assertUidValidity = () => {
              const checkpoint = db
                .prepare("SELECT uid_validity FROM sync_state WHERE account=? AND folder=?")
                .get(account, folder) as any;
              if (
                checkpoint?.uid_validity &&
                client.mailbox &&
                String(client.mailbox.uidValidity) !== String(checkpoint.uid_validity)
              )
                throw new Error("Mailbox UID validity changed; sync before reading bodies");
            };
            assertUidValidity();
            const missing = group.filter((ref) => {
              const row = lookup.get(ref.account, ref.folder, ref.uid) as any;
              if (!row) throw new Error("message is no longer available in the synced mailbox cache");
              if (row.body_fetched) {
                metrics.cache_hits++;
                return false;
              }
              return true;
            });
            metrics.network_messages += missing.length;
            await fetchBodyBatches(
              client,
              missing.map((ref) => Number(ref.uid)),
              async (messages) => {
                const parseStarted = performance.now();
                const parsedRows: Array<{
                  uid: string;
                  text: string;
                  html: string;
                  attachments: Array<{ filename: string; content_type: string; size: number }>;
                }> = [];
                for (const message of messages) {
                  const parsed = await PostalMime.parse(message.source!, {
                    maxNestingDepth: 64,
                    maxHeadersSize: 2 * 1024 * 1024,
                    maxRfc822NestingDepth: 5,
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
                  parsedRows.push({
                    uid: String(message.uid),
                    text: parsed.text || "",
                    html: parsed.html || "",
                    attachments,
                  });
                }
                metrics.parse_ms += performance.now() - parseStarted;
                const cacheStarted = performance.now();
                db.transaction(() => {
                  assertUidValidity();
                  for (const row of parsedRows) {
                    if (
                      !update.run(row.text, row.html, JSON.stringify(row.attachments), now(), account, folder, row.uid)
                        .changes
                    )
                      throw new Error("message is no longer available in the synced mailbox cache");
                  }
                })();
                metrics.cache_ms += performance.now() - cacheStarted;
              },
              metrics,
            );
          },
          metrics,
        );
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        for (const ref of group)
          if (pendingBodyReads.get(bodyKey(ref)) === completion) pendingBodyReads.delete(bodyKey(ref));
      }
    });
  }
  // Install all per-message promises before running work, so overlapping readers
  // share the same fetch. Limit concurrent account/folder groups to four.
  const allReads = Promise.all(waits);
  const worker = async () => {
    while (jobs.length) await jobs.shift()!();
  };
  await Promise.all([allReads, ...Array.from({ length: Math.min(4, jobs.length) }, worker)]);
  const finishStarted = performance.now();
  const messages = refs.map((ref) => {
    const existing = find.get(ref.account, ref.folder, ref.uid) as any;
    if (!existing?.body_fetched) throw new Error("message is no longer available in the synced mailbox cache");
    const value = { ...existing, attachments: json(existing.attachments_json, []) };
    delete value.attachments_json;
    return value;
  });
  metrics.cache_ms += performance.now() - finishStarted;
  metrics.total_ms = performance.now() - started;
  return { messages, metrics };
}

export async function readMessage(accountName: string, uid: string, folder?: string) {
  const existing = db
    .prepare(`SELECT folder FROM messages WHERE account=? AND uid=? AND present=1
    ${folder ? "AND folder=?" : ""} ORDER BY CASE WHEN folder='INBOX' THEN 0 ELSE 1 END,date_ts DESC LIMIT 1`)
    .get(accountName, uid, ...(folder ? [folder] : [])) as any;
  if (!existing) throw new Error("message is no longer available in the synced mailbox cache");
  const result = await readMessages([{ account: accountName, folder: existing.folder, uid }]);
  return { ...result.messages[0], read_metrics: result.metrics };
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
  items: Array<{ account: string; uid: string; source_folder: string; folder?: string }>,
) {
  const results: any[] = [],
    errors: any[] = [];
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.source_folder) throw new Error("every mailbox action requires an exact source folder");
    const key = JSON.stringify([item.account, item.source_folder]);
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  for (const [key, accountItems] of groups) {
    const [accountName, sourceFolder] = JSON.parse(key) as [string, string];
    const account = accountByName(accountName);
    if (!account) {
      errors.push(...accountItems.map((item) => ({ item, error: "unknown account" })));
      continue;
    }
    try {
      await withMailbox(account, sourceFolder, false, async (client) => {
        const provider = providerForConnection(client.capabilities, account.host);
        const sourceSpecialUse = (
          db
            .prepare("SELECT special_use FROM imap_folders WHERE account=? AND path=?")
            .get(accountName, sourceFolder) as { special_use?: string } | undefined
        )?.special_use;
        const sourceIsAllMail = provider === "gmail" && sourceSpecialUse === "\\All";
        if (action === "archive") {
          const uids = accountItems.map((item) => Number(item.uid));
          if (provider === "gmail")
            requireApplied(
              await client.messageFlagsRemove(uids, ["\\Inbox"], { uid: true, useLabels: true, silent: true }),
              "archive",
            );
          else
            requireApplied(
              await client.messageMove(uids, await specialMailbox(client, "\\Archive", "Archive"), { uid: true }),
              "archive",
            );
          results.push(
            ...accountItems.map((item) => ({
              account: accountName,
              uid: item.uid,
              source_folder: sourceFolder,
              cache_hidden: !sourceIsAllMail,
              ok: true,
            })),
          );
        } else if (action === "delete") {
          const uids = accountItems.map((item) => Number(item.uid));
          if (provider === "gmail")
            requireApplied(
              await client.messageMove(uids, await specialMailbox(client, "\\Trash", "[Gmail]/Trash"), { uid: true }),
              "delete",
            );
          else requireApplied(await client.messageDelete(uids, { uid: true }), "delete");
          results.push(
            ...accountItems.map((item) => ({
              account: accountName,
              uid: item.uid,
              source_folder: sourceFolder,
              cache_hidden: true,
              ok: true,
            })),
          );
        } else {
          for (const item of accountItems) {
            if (!item.folder || !/^[\w .@+\-/]{1,100}$/.test(item.folder)) {
              errors.push({ item, error: "invalid destination folder" });
              continue;
            }
            if (provider === "gmail") {
              requireApplied(
                await client.messageFlagsAdd(Number(item.uid), [item.folder], {
                  uid: true,
                  useLabels: true,
                  silent: true,
                }),
                "label",
              );
              if (!sourceIsAllMail)
                requireApplied(
                  await client.messageFlagsRemove(
                    Number(item.uid),
                    [sourceFolder.toLowerCase() === "inbox" ? "\\Inbox" : sourceFolder],
                    { uid: true, useLabels: true, silent: true },
                  ),
                  "move",
                );
            } else requireApplied(await client.messageMove(Number(item.uid), item.folder, { uid: true }), "move");
            results.push({
              account: accountName,
              uid: item.uid,
              source_folder: sourceFolder,
              cache_hidden: !sourceIsAllMail,
              ok: true,
            });
          }
        }
      });
    } catch (error: any) {
      errors.push(...accountItems.map((item) => ({ item, error: String(error?.message || error) })));
    }
  }
  const hide = db.prepare("UPDATE messages SET present=0 WHERE account=? AND folder=? AND uid=?");
  const updateLabels = db.prepare("UPDATE messages SET labels_json=? WHERE account=? AND folder=? AND uid=?");
  const selectLabels = db.prepare("SELECT labels_json FROM messages WHERE account=? AND folder=? AND uid=?");
  db.transaction(() => {
    for (const result of results) {
      if (result.cache_hidden) hide.run(result.account, result.source_folder, result.uid);
      else {
        const row = selectLabels.get(result.account, result.source_folder, result.uid) as
          | { labels_json?: string }
          | undefined;
        const labels = new Set<string>(json(row?.labels_json, []));
        labels.delete("\\Inbox");
        const item = items.find(
          (candidate) =>
            candidate.account === result.account &&
            candidate.uid === result.uid &&
            candidate.source_folder === result.source_folder,
        );
        if (action === "move" && item?.folder) labels.add(item.folder);
        updateLabels.run(JSON.stringify([...labels]), result.account, result.source_folder, result.uid);
      }
    }
  })();
  return { status: errors.length ? "partial_failure" : "applied", results, errors };
}
