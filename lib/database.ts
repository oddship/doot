import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { escapedLikeContains, parseSearchQuery } from "@/lib/search-query";

const DB_PATH = process.env.DOOT_DATABASE_PATH || path.join(process.cwd(), "email-cache.sqlite3");

type GlobalDatabase = typeof globalThis & { __emailAgentDatabase?: Database.Database };
const globalDatabase = globalThis as GlobalDatabase;

function openDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const connection = new Database(DB_PATH, { timeout: 20_000 });
  try {
    fs.chmodSync(DB_PATH, 0o600);
  } catch {}
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 20000");
  connection.pragma("temp_store = MEMORY");
  connection.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      account TEXT NOT NULL, account_email TEXT NOT NULL, uid TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT 'INBOX', sender TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '',
      date_ts INTEGER NOT NULL DEFAULT 0, body_text TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '', attachments_json TEXT NOT NULL DEFAULT '[]',
      body_fetched INTEGER NOT NULL DEFAULT 0, flags_json TEXT NOT NULL DEFAULT '[]',
      unread INTEGER NOT NULL DEFAULT 0, present INTEGER NOT NULL DEFAULT 1,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY(account,uid));
    CREATE TABLE IF NOT EXISTS sync_state (
      account TEXT PRIMARY KEY, last_uid INTEGER NOT NULL DEFAULT 0,
      last_sync TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS email_accounts (
      name TEXT PRIMARY KEY, host TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 993,
      use_ssl INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_credentials (
      provider TEXT PRIMARY KEY, api_key TEXT NOT NULL DEFAULT '',
      auth_type TEXT NOT NULL DEFAULT 'api_key', credential_json TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
      spec_json TEXT NOT NULL, created_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 0, session_id TEXT);
    CREATE TABLE IF NOT EXISTS agent_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL,
      content_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed', items_json TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Doot session',
      history_kind TEXT NOT NULL DEFAULT 'agent',
      model_provider TEXT, model_id TEXT, status TEXT NOT NULL DEFAULT 'ready',
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      event_type TEXT NOT NULL, role TEXT, content TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS agent_memory (
      namespace TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(namespace,key));
    CREATE TABLE IF NOT EXISTS imap_folders (
      account TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL,
      delimiter TEXT NOT NULL DEFAULT '/', parent_path TEXT NOT NULL DEFAULT '',
      special_use TEXT, flags_json TEXT NOT NULL DEFAULT '[]',
      subscribed INTEGER NOT NULL DEFAULT 0, discovered_at TEXT NOT NULL,
      PRIMARY KEY(account,path));
    CREATE TABLE IF NOT EXISTS email_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      account TEXT NOT NULL DEFAULT 'all', query TEXT NOT NULL,
      action TEXT NOT NULL, target_folder TEXT,
      status TEXT NOT NULL DEFAULT 'draft', enabled INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual', rationale TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_matched INTEGER);
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      rule_id INTEGER,
      frequency TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(rule_id) REFERENCES email_rules(id) ON DELETE CASCADE);
    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
      account UNINDEXED, uid UNINDEXED, sender, subject,
      tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO message_fts(account,uid,sender,subject) VALUES(new.account,new.uid,new.sender,new.subject);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      DELETE FROM message_fts WHERE account=old.account AND uid=old.uid;
    END;
    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF account,uid,sender,subject ON messages BEGIN
      DELETE FROM message_fts WHERE account=old.account AND uid=old.uid;
      INSERT INTO message_fts(account,uid,sender,subject) VALUES(new.account,new.uid,new.sender,new.subject);
    END;
    CREATE INDEX IF NOT EXISTS messages_date ON messages(date_ts DESC);
    CREATE INDEX IF NOT EXISTS messages_account_date ON messages(account,date_ts DESC);
    CREATE INDEX IF NOT EXISTS messages_account_present_date ON messages(account,present,date_ts DESC);
    CREATE INDEX IF NOT EXISTS agent_sessions_updated ON agent_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS agent_events_session ON agent_events(session_id,id);
    CREATE INDEX IF NOT EXISTS agent_views_session ON agent_views(session_id,id DESC);
    CREATE INDEX IF NOT EXISTS actions_status_created ON actions(status,created_at DESC);
    CREATE INDEX IF NOT EXISTS email_rules_status_updated ON email_rules(status,enabled,updated_at DESC);
    CREATE INDEX IF NOT EXISTS schedules_due ON schedules(enabled,next_run_at);
  `);

  const messageColumns = new Set(
    (connection.prepare("PRAGMA table_info(messages)").all() as any[]).map((row) => row.name),
  );
  if (!messageColumns.has("date_ts"))
    connection.exec("ALTER TABLE messages ADD COLUMN date_ts INTEGER NOT NULL DEFAULT 0");
  if (!messageColumns.has("flags_json"))
    connection.exec("ALTER TABLE messages ADD COLUMN flags_json TEXT NOT NULL DEFAULT '[]'");
  if (!messageColumns.has("unread"))
    connection.exec("ALTER TABLE messages ADD COLUMN unread INTEGER NOT NULL DEFAULT 0");
  if (!messageColumns.has("present"))
    connection.exec("ALTER TABLE messages ADD COLUMN present INTEGER NOT NULL DEFAULT 1");
  const viewColumns = new Set(
    (connection.prepare("PRAGMA table_info(agent_views)").all() as any[]).map((row) => row.name),
  );
  if (!viewColumns.has("schema_version"))
    connection.exec("ALTER TABLE agent_views ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0");
  if (!viewColumns.has("session_id")) connection.exec("ALTER TABLE agent_views ADD COLUMN session_id TEXT");
  const syncColumns = new Set(
    (connection.prepare("PRAGMA table_info(sync_state)").all() as any[]).map((row) => row.name),
  );
  if (!syncColumns.has("uid_validity")) connection.exec("ALTER TABLE sync_state ADD COLUMN uid_validity TEXT");
  if (!syncColumns.has("mailbox_messages"))
    connection.exec("ALTER TABLE sync_state ADD COLUMN mailbox_messages INTEGER");
  if (!syncColumns.has("mailbox_unseen")) connection.exec("ALTER TABLE sync_state ADD COLUMN mailbox_unseen INTEGER");
  const sessionColumns = new Set(
    (connection.prepare("PRAGMA table_info(agent_sessions)").all() as any[]).map((row) => row.name),
  );
  if (!sessionColumns.has("history_kind"))
    connection.exec("ALTER TABLE agent_sessions ADD COLUMN history_kind TEXT NOT NULL DEFAULT 'agent'");
  const credentialColumns = new Set(
    (connection.prepare("PRAGMA table_info(agent_credentials)").all() as any[]).map((row) => row.name),
  );
  if (!credentialColumns.has("auth_type"))
    connection.exec("ALTER TABLE agent_credentials ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key'");
  if (!credentialColumns.has("credential_json"))
    connection.exec("ALTER TABLE agent_credentials ADD COLUMN credential_json TEXT NOT NULL DEFAULT ''");
  connection
    .prepare(`INSERT INTO message_fts(account,uid,sender,subject)
    SELECT m.account,m.uid,m.sender,m.subject FROM messages m
    WHERE NOT EXISTS(SELECT 1 FROM message_fts f WHERE f.account=m.account AND f.uid=m.uid)`)
    .run();
  return connection;
}

if (!globalDatabase.__emailAgentDatabase) globalDatabase.__emailAgentDatabase = openDatabase();
export const db = globalDatabase.__emailAgentDatabase;

export const DEFAULT_SETTINGS = {
  sync_days: 30,
  initial_sync_limit: 75,
  sync_on_start: false,
  auto_organize: false,
  agent_delegation: false,
  allow_remote_images: false,
  share_message_content: false,
  agent_provider: "",
  agent_model: "",
  agent_thinking: "medium",
} as const;

const insertSetting = db.prepare("INSERT OR IGNORE INTO settings(key,value_json) VALUES (?,?)");
db.transaction(() => {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, JSON.stringify(value));
})();

export function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
export function dateTimestamp(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}
export function json<T = any>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export type StoredAccount = {
  name: string;
  host: string;
  username: string;
  password: string;
  port: number;
  use_ssl: number;
};
export function configuredAccounts() {
  return db.prepare("SELECT * FROM email_accounts ORDER BY username").all() as StoredAccount[];
}
export function accountByName(name: string) {
  return db.prepare("SELECT * FROM email_accounts WHERE name=?").get(name) as StoredAccount | undefined;
}

export function settingsValue() {
  const values: Record<string, any> = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare("SELECT key,value_json FROM settings").all() as any[])
    values[row.key] = json(row.value_json, values[row.key]);
  return values;
}

function safeFtsQuery(value: unknown) {
  const tokens =
    String(value || "")
      .match(/[A-Za-z0-9_]+/g)
      ?.slice(0, 12) || [];
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export function messageWhere(input: {
  account?: string;
  query?: string;
  sender?: string;
  domain?: string;
  days?: number;
}) {
  const clauses: string[] = ["messages.present=1"],
    values: any[] = [];
  if (input.account && input.account !== "all") {
    clauses.push("messages.account=?");
    values.push(input.account);
  }
  if (input.query) {
    const parsed = parseSearchQuery(input.query);
    for (const sender of parsed.senders) {
      clauses.push("messages.sender LIKE ? ESCAPE '\\'");
      values.push(escapedLikeContains(sender));
    }
    for (const subject of parsed.subjects) {
      clauses.push("messages.subject LIKE ? ESCAPE '\\'");
      values.push(escapedLikeContains(subject));
    }
    for (const domain of parsed.domains) {
      clauses.push("messages.sender LIKE ? ESCAPE '\\'");
      values.push(escapedLikeContains(`@${domain}`));
    }
    const query = safeFtsQuery(parsed.text);
    if (query) {
      clauses.push(
        "EXISTS(SELECT 1 FROM message_fts WHERE message_fts.account=messages.account AND message_fts.uid=messages.uid AND message_fts MATCH ?)",
      );
      values.push(query);
    } else if (!parsed.senders.length && !parsed.subjects.length && !parsed.domains.length) clauses.push("0");
  }
  if (input.sender) {
    clauses.push("messages.sender LIKE ? ESCAPE '\\'");
    values.push(escapedLikeContains(input.sender));
  }
  if (input.domain) {
    clauses.push("messages.sender LIKE ? ESCAPE '\\'");
    values.push(escapedLikeContains(`@${input.domain.replace(/^@/, "")}`));
  }
  if (input.days) {
    clauses.push("messages.date_ts>=?");
    values.push(Math.floor(Date.now() / 1000) - Math.max(1, Math.min(input.days, 3650)) * 86400);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return { where, values };
}

export function queryMessages(input: {
  account?: string;
  query?: string;
  sender?: string;
  domain?: string;
  days?: number;
  offset?: number;
  limit?: number;
  focusUid?: string;
  includeBodyFetched?: boolean;
}) {
  const { where, values } = messageWhere(input);
  const limit = Math.max(1, Math.min(input.limit || 25, 100));
  let offset = Math.max(0, input.offset || 0);
  let focusFound = false;
  if (input.focusUid && /^\d+$/.test(input.focusUid)) {
    const focused = db
      .prepare(`SELECT date_ts,CAST(uid AS INTEGER) uid_number FROM messages${where} AND messages.uid=? LIMIT 1`)
      .get(...values, input.focusUid) as { date_ts: number; uid_number: number } | undefined;
    if (focused) {
      focusFound = true;
      const rank = Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) count FROM messages${where} AND
              (messages.date_ts>? OR (messages.date_ts=? AND CAST(messages.uid AS INTEGER)>?))`,
            )
            .get(...values, focused.date_ts, focused.date_ts, focused.uid_number) as { count: number }
        ).count,
      );
      offset = Math.floor(rank / limit) * limit;
    }
  }
  const fields = `account,account_email,uid,sender,subject,date,date_ts,unread${input.includeBodyFetched ? ",body_fetched" : ""}`;
  const messages = db
    .prepare(`SELECT ${fields} FROM messages${where} ORDER BY date_ts DESC,CAST(uid AS INTEGER) DESC LIMIT ? OFFSET ?`)
    .all(...values, limit, offset);
  const total = Number((db.prepare(`SELECT COUNT(*) count FROM messages${where}`).get(...values) as any).count);
  return {
    messages,
    total,
    offset,
    limit,
    focus_found: focusFound,
    next_offset: offset + messages.length < total ? offset + messages.length : null,
  };
}
