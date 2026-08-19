import {
  accountByName,
  configuredAccounts,
  DEFAULT_SETTINGS,
  db,
  json,
  messageWhere,
  now,
  queryMessages,
  settingsValue,
} from "@/lib/database";
import {
  applyMailboxAction,
  discoverAccountFolders,
  mutateAccountFolder,
  readMessage,
  syncAccount,
  testAccount,
} from "@/lib/imap";
import { type FolderMutation, isProtectedMailbox } from "@/lib/imap-folder";
import { providerForHost } from "@/lib/mail-provider";
import {
  deleteRule,
  getRule,
  knownMoveDestination,
  listRules,
  markRuleMatched,
  prepareRuleProposal,
  previewRule,
  reconcileFolderRules,
  saveRule,
} from "@/lib/rules";

function option(args: string[], name: string, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}
function numberOption(args: string[], name: string, fallback: number) {
  const value = Number(option(args, name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}
function required(value: string | undefined, message: string) {
  if (!value) throw new Error(message);
  return value;
}
function parseValue<T = any>(value: string | undefined, message = "invalid JSON") {
  try {
    return JSON.parse(required(value, message)) as T;
  } catch {
    throw new Error(message);
  }
}

function dashboard() {
  const totals = db
    .prepare("SELECT COUNT(*) cached,SUM(CASE WHEN body_fetched=1 THEN 1 ELSE 0 END) bodies FROM messages")
    .get();
  const accounts = db
    .prepare(`SELECT m.account,m.account_email,COUNT(*) cached,MAX(s.last_sync) last_sync,MAX(s.last_error) last_error
    FROM messages m LEFT JOIN sync_state s ON s.account=m.account GROUP BY m.account,m.account_email ORDER BY m.account`)
    .all();
  const recent = db
    .prepare(
      "SELECT account,account_email,uid,sender,subject,date FROM messages ORDER BY date_ts DESC,CAST(uid AS INTEGER) DESC LIMIT 12",
    )
    .all();
  const actions = (
    db
      .prepare("SELECT id,action,status,reason,items_json,created_at FROM actions ORDER BY id DESC LIMIT 10")
      .all() as any[]
  ).map((row) => ({ ...row, items: json(row.items_json, []), items_json: undefined }));
  const view = db
    .prepare(
      "SELECT id,spec_json,created_at,schema_version,session_id FROM agent_views WHERE kind='organization' ORDER BY id DESC LIMIT 1",
    )
    .get() as any;
  const generated = view
    ? {
        id: view.id,
        spec: json(view.spec_json, {}),
        created_at: view.created_at,
        schema_version: view.schema_version,
        session_id: view.session_id,
      }
    : null;
  return { totals, accounts, recent, actions: actions.map(({ items_json: _discard, ...row }) => row), generated };
}

function facets(input: { account?: string; query?: string; days?: number; limit?: number }) {
  const { where, values } = messageWhere(input);
  const limit = Math.max(5, Math.min(input.limit || 25, 50));
  const total = Number((db.prepare(`SELECT COUNT(*) count FROM messages${where}`).get(...values) as any).count);
  const accounts = db
    .prepare(
      `SELECT account,account_email,COUNT(*) count FROM messages${where} GROUP BY account,account_email ORDER BY count DESC`,
    )
    .all(...values);
  const top_senders = db
    .prepare(
      `SELECT sender name,COUNT(*) count FROM messages${where} GROUP BY sender ORDER BY count DESC,sender LIMIT ?`,
    )
    .all(...values, limit) as any[];
  const domainCounts = new Map<string, number>();
  for (const row of db.prepare(`SELECT sender FROM messages${where}`).all(...values) as any[]) {
    const match = String(row.sender).match(/@([A-Za-z0-9.-]+)/);
    const domain = match?.[1]?.toLowerCase() || "unknown";
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
  }
  const top_domains = [...domainCounts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
  const timestamp = Math.floor(Date.now() / 1000);
  const age_buckets = [
    ["last_24_hours", timestamp - 86400, timestamp + 1],
    ["last_7_days", timestamp - 7 * 86400, timestamp - 86400],
    ["last_30_days", timestamp - 30 * 86400, timestamp - 7 * 86400],
    ["older", 0, timestamp - 30 * 86400],
  ].map(([label, lower, upper]) => {
    const join = where ? `${where} AND` : " WHERE";
    return {
      label,
      count: Number(
        (
          db
            .prepare(`SELECT COUNT(*) count FROM messages${join} date_ts>=? AND date_ts<?`)
            .get(...values, lower, upper) as any
        ).count,
      ),
    };
  });
  return { total, filters: input, accounts, top_senders, top_domains, age_buckets };
}

function accountList() {
  return {
    accounts: configuredAccounts().map((account) => ({
      name: account.name,
      email: account.username,
      host: account.host,
      port: account.port,
      use_ssl: Boolean(account.use_ssl),
      has_password: Boolean(account.password),
      provider: providerForHost(account.host),
    })),
  };
}

function accountUpsert(value: any) {
  if (!value || typeof value !== "object") throw new Error("username and host are required");
  const username = String(value.username || "")
      .trim()
      .toLowerCase(),
    host = String(value.host || "")
      .trim()
      .toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) throw new Error("invalid email address");
  if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new Error("invalid IMAP host");
  const name = String(value.name || username.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
  if (!/^[a-z0-9_]{3,100}$/.test(name)) throw new Error("invalid account identifier");
  const existing = accountByName(name);
  const password = String(value.password || existing?.password || "");
  if (!password) throw new Error("password or app password is required");
  const port = Math.max(1, Math.min(Number(value.port || 993), 65535)),
    useSsl = value.use_ssl !== false,
    timestamp = now();
  db.prepare(`INSERT INTO email_accounts(name,host,username,password,port,use_ssl,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET host=excluded.host,username=excluded.username,password=excluded.password,port=excluded.port,use_ssl=excluded.use_ssl,updated_at=excluded.updated_at`).run(
    name,
    host,
    username,
    password,
    port,
    Number(useSsl),
    existing
      ? (db.prepare("SELECT created_at FROM email_accounts WHERE name=?").get(name) as any).created_at
      : timestamp,
    timestamp,
  );
  return {
    account: {
      name,
      email: username,
      host,
      port,
      use_ssl: useSsl,
      has_password: true,
      provider: providerForHost(host),
    },
  };
}

function workspaceGet(id: string) {
  const row = (
    id === "latest"
      ? db
          .prepare(
            "SELECT id,kind,spec_json,created_at,schema_version,session_id FROM agent_views ORDER BY id DESC LIMIT 1",
          )
          .get()
      : db
          .prepare("SELECT id,kind,spec_json,created_at,schema_version,session_id FROM agent_views WHERE id=?")
          .get(Number(id))
  ) as any;
  if (!row) throw new Error("workspace not found");
  return { workspace: { ...row, spec: json(row.spec_json, {}), spec_json: undefined } };
}

function sessionGet(id: string) {
  const session = db.prepare("SELECT * FROM agent_sessions WHERE id=?").get(id) as any;
  if (!session) throw new Error("unknown session");
  const events = (
    db
      .prepare(
        "SELECT id,event_type,role,content,metadata_json,created_at FROM agent_events WHERE session_id=? ORDER BY id",
      )
      .all(id) as any[]
  ).map((row) => ({ ...row, metadata: json(row.metadata_json, {}), metadata_json: undefined }));
  const row = db
    .prepare(
      "SELECT id,kind,spec_json,created_at,schema_version,session_id FROM agent_views WHERE session_id=? ORDER BY id DESC LIMIT 1",
    )
    .get(id) as any;
  const workspace = row ? { ...row, spec: json(row.spec_json, {}), spec_json: undefined } : null;
  return { session, events: events.map(({ metadata_json: _discard, ...event }) => event), workspace };
}

function validateMemory(namespace: string, key?: string) {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(namespace)) throw new Error("invalid memory namespace");
  if (key !== undefined && !/^[A-Za-z0-9_./:@+-]{1,160}$/.test(key)) throw new Error("invalid memory key");
}

export function emitBackground(event: unknown) {
  globalThis.__emailAgentBroadcast?.(event);
}

export async function store<T = any>(args: string[] = []): Promise<T> {
  const [command, ...rest] = args;
  let result: any;
  switch (command) {
    case "accounts":
      result = accountList();
      break;
    case "account-upsert":
      result = accountUpsert(parseValue(rest[0]));
      break;
    case "account-delete": {
      const name = required(rest[0], "account is required");
      if (!accountByName(name)) throw new Error("unknown account");
      db.prepare("DELETE FROM email_accounts WHERE name=?").run(name);
      result = { deleted: name, cache_retained: true };
      break;
    }
    case "account-test":
      result = await testAccount(required(rest[0], "account is required"));
      break;
    case "account-folders":
      result = await discoverAccountFolders(required(rest[0], "account is required"));
      break;
    case "folder-mutate": {
      const account = required(rest[0], "account is required");
      const mutation = parseValue<FolderMutation>(rest[1]);
      if (!mutation || !["create", "rename", "delete"].includes(mutation.action))
        throw new Error("invalid folder operation");
      const cached = db
        .prepare("SELECT delimiter FROM imap_folders WHERE account=? AND path=?")
        .get(account, mutation.path) as any;
      result = await mutateAccountFolder(account, mutation);
      reconcileFolderRules(account, mutation, cached?.delimiter || result.folders[0]?.delimiter || "/");
      break;
    }
    case "folder-cache":
      result = {
        folders: (
          db
            .prepare(
              "SELECT f.account,f.path,f.name,f.delimiter,f.parent_path,f.special_use,f.flags_json,f.subscribed,f.discovered_at,a.host FROM imap_folders f LEFT JOIN email_accounts a ON a.name=f.account ORDER BY f.account,f.path",
            )
            .all() as any[]
        ).map((row) => {
          const flags = json<string[]>(row.flags_json, []),
            provider = providerForHost(row.host || ""),
            protectedFolder = isProtectedMailbox({ path: row.path, special_use: row.special_use, flags }, provider);
          return {
            account: row.account,
            path: row.path,
            name: row.name,
            delimiter: row.delimiter,
            parent_path: row.parent_path,
            special_use: row.special_use,
            flags,
            subscribed: Boolean(row.subscribed),
            discovered_at: row.discovered_at,
            provider,
            kind: provider === "gmail" ? "label" : "folder",
            protected: protectedFolder,
            rule_target_allowed: !protectedFolder,
          };
        }),
      };
      break;
    case "rule-list":
      result = { rules: listRules() };
      break;
    case "rule-get":
      result = { rule: getRule(Number(required(rest[0], "rule id is required"))) };
      break;
    case "rule-upsert":
      result = { rule: saveRule(parseValue(rest[0])) };
      break;
    case "rule-delete": {
      const id = Number(required(rest[0], "rule id is required"));
      result = { id, deleted: deleteRule(id) };
      break;
    }
    case "rule-preview": {
      const id = Number(required(rest[0], "rule id is required"));
      result = previewRule(id, numberOption(rest, "--offset", 0), numberOption(rest, "--limit", 25));
      break;
    }
    case "rule-propose": {
      const id = Number(required(rest[0], "rule id is required"));
      const prepared = prepareRuleProposal(id);
      const proposal = await store<any>([
        "propose",
        prepared.rule.action,
        JSON.stringify(prepared.items),
        "--reason",
        `Flow: ${prepared.rule.name}`,
      ]);
      markRuleMatched(id, prepared.matched);
      result = { rule: prepared.rule, matched: prepared.matched, proposed: prepared.items.length, proposal };
      break;
    }
    case "sync": {
      const requestedAccount = option(rest, "--account");
      const names = requestedAccount ? [requestedAccount] : configuredAccounts().map((account) => account.name);
      const values = await Promise.all(
        names.map((name) =>
          syncAccount({
            name,
            days: numberOption(rest, "--days", 30),
            limit: numberOption(rest, "--limit", 75),
            refresh: rest.includes("--refresh"),
          }),
        ),
      );
      result = {
        synced_at: now(),
        accounts: values.flatMap((value) => value.accounts),
        errors: values.flatMap((value) => value.errors),
        elapsed_ms: Math.max(0, ...values.map((value) => value.elapsed_ms)),
      };
      break;
    }
    case "list": {
      const account = option(rest, "--account", "all");
      result = queryMessages({
        account,
        query: option(rest, "--query"),
        offset: numberOption(rest, "--offset", 0),
        limit: numberOption(rest, "--limit", 20),
        includeBodyFetched: true,
      });
      result.mailbox =
        account === "all"
          ? null
          : db
              .prepare(
                "SELECT mailbox_messages messages,mailbox_unseen unseen,last_sync FROM sync_state WHERE account=?",
              )
              .get(account) || null;
      break;
    }
    case "search":
      result = {
        ...queryMessages({
          account: option(rest, "--account", "all"),
          query: option(rest, "--query"),
          sender: option(rest, "--sender"),
          domain: option(rest, "--domain"),
          days: numberOption(rest, "--days", 0),
          offset: numberOption(rest, "--offset", 0),
          limit: numberOption(rest, "--limit", 50),
        }),
        filters: {
          account: option(rest, "--account", "all"),
          query: option(rest, "--query"),
          sender: option(rest, "--sender"),
          domain: option(rest, "--domain"),
          days: numberOption(rest, "--days", 0),
        },
      };
      break;
    case "facets":
      result = facets({
        account: option(rest, "--account", "all"),
        query: option(rest, "--query"),
        days: numberOption(rest, "--days", 0),
        limit: numberOption(rest, "--limit", 25),
      });
      break;
    case "organization-data": {
      const page = queryMessages({
        account: option(rest, "--account", "all"),
        limit: numberOption(rest, "--limit", 120),
      });
      const counts = new Map<string, number>(),
        domains = new Map<string, number>();
      for (const row of page.messages as any[]) {
        counts.set(row.sender, (counts.get(row.sender) || 0) + 1);
        const domain =
          String(row.sender)
            .match(/@([A-Za-z0-9.-]+)/)?.[1]
            ?.toLowerCase() || "unknown";
        domains.set(domain, (domains.get(domain) || 0) + 1);
      }
      const top = (values: Map<string, number>) =>
        [...values]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 15)
          .map(([name, count]) => ({ name, count }));
      result = {
        messages: page.messages,
        top_senders: top(counts),
        top_domains: top(domains),
        analyzed: page.messages.length,
      };
      break;
    }
    case "message-context": {
      const items = parseValue<Array<{ account: string; uid: string }>>(rest[0]);
      if (!Array.isArray(items) || items.length > 100) throw new Error("invalid selected message context");
      const find = db.prepare(
        "SELECT account,account_email,uid,sender,subject,date FROM messages WHERE account=? AND uid=?",
      );
      result = { messages: items.map((item) => find.get(item.account, String(item.uid))).filter(Boolean) };
      break;
    }
    case "read":
      result = await readMessage(required(rest[0], "account is required"), required(rest[1], "uid is required"));
      break;
    case "dashboard":
      result = dashboard();
      break;
    case "view-save": {
      const spec = parseValue(rest[0]);
      const encoded = JSON.stringify(spec);
      if (encoded.length > 100_000) throw new Error("invalid generated view");
      const info = db
        .prepare(
          "INSERT INTO agent_views(kind,spec_json,created_at,schema_version,session_id) VALUES('organization',?,?,?,?)",
        )
        .run(encoded, now(), numberOption(rest, "--schema-version", 1), option(rest, "--session-id") || null);
      db.prepare("DELETE FROM agent_views WHERE id NOT IN(SELECT id FROM agent_views ORDER BY id DESC LIMIT 10)").run();
      result = {
        saved: true,
        id: Number(info.lastInsertRowid),
        schema_version: numberOption(rest, "--schema-version", 1),
        session_id: option(rest, "--session-id") || null,
      };
      break;
    }
    case "workspace-get":
      result = workspaceGet(required(rest[0], "workspace id is required"));
      break;
    case "artifact-save": {
      const value = parseValue<any>(rest[0]);
      if (!["draft", "rule", "note"].includes(value.kind)) throw new Error("invalid artifact");
      const title = String(value.title || "Untitled").slice(0, 200);
      const encoded = JSON.stringify(value.content);
      if (value.content === undefined || encoded.length > 50_000) throw new Error("invalid artifact content");
      const info = db
        .prepare("INSERT INTO agent_artifacts(kind,title,content_json,created_at) VALUES(?,?,?,?)")
        .run(value.kind, title, encoded, now());
      result = { id: Number(info.lastInsertRowid), kind: value.kind, title, content: value.content, status: "draft" };
      break;
    }
    case "artifact-list":
      result = {
        artifacts: (
          db
            .prepare(
              "SELECT id,kind,title,content_json,status,created_at FROM agent_artifacts ORDER BY id DESC LIMIT 30",
            )
            .all() as any[]
        )
          .map((row) => ({ ...row, content: json(row.content_json, null), content_json: undefined }))
          .map(({ content_json: _discard, ...row }) => row),
      };
      break;
    case "memory-set": {
      const [namespace, key] = [required(rest[0], "namespace is required"), required(rest[1], "key is required")];
      validateMemory(namespace, key);
      const value = parseValue(rest[2]);
      const encoded = JSON.stringify(value);
      if (Buffer.byteLength(encoded) > 20_000) throw new Error("memory value exceeds 20 KB");
      const exists = Boolean(db.prepare("SELECT 1 FROM agent_memory WHERE namespace=? AND key=?").get(namespace, key));
      const timestamp = now();
      db.prepare(
        `INSERT INTO agent_memory(namespace,key,value_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
      ).run(namespace, key, encoded, timestamp, timestamp);
      result = { namespace, key, value, created: !exists, updated_at: timestamp };
      break;
    }
    case "memory-get": {
      const [namespace, key] = [required(rest[0], "namespace is required"), required(rest[1], "key is required")];
      validateMemory(namespace, key);
      const row = db
        .prepare("SELECT namespace,key,value_json,created_at,updated_at FROM agent_memory WHERE namespace=? AND key=?")
        .get(namespace, key) as any;
      result = row
        ? { ...row, value: json(row.value_json, null), value_json: undefined, found: true }
        : { found: false, namespace, key };
      if (result.value_json === undefined) delete result.value_json;
      break;
    }
    case "memory-list": {
      const namespace = required(rest[0], "namespace is required"),
        prefix = option(rest, "--prefix");
      validateMemory(namespace);
      if (prefix.length > 160) throw new Error("memory prefix is too long");
      const items = (
        db
          .prepare(
            "SELECT namespace,key,value_json,created_at,updated_at FROM agent_memory WHERE namespace=? AND key LIKE ? ORDER BY key LIMIT ?",
          )
          .all(namespace, `${prefix}%`, Math.max(1, Math.min(numberOption(rest, "--limit", 50), 100))) as any[]
      ).map((row) => ({
        namespace: row.namespace,
        key: row.key,
        created_at: row.created_at,
        updated_at: row.updated_at,
        value: json(row.value_json, null),
      }));
      result = { namespace, prefix, items };
      break;
    }
    case "memory-namespaces":
      result = {
        namespaces: db
          .prepare(
            "SELECT namespace,COUNT(*) count,MAX(updated_at) updated_at FROM agent_memory GROUP BY namespace ORDER BY namespace",
          )
          .all(),
      };
      break;
    case "memory-context":
      result = {
        namespaces: db
          .prepare(
            "SELECT namespace,COUNT(*) count,MAX(updated_at) updated_at FROM agent_memory GROUP BY namespace ORDER BY namespace",
          )
          .all(),
        items: db.prepare("SELECT namespace,key,updated_at FROM agent_memory ORDER BY updated_at DESC LIMIT 20").all(),
      };
      break;
    case "memory-delete": {
      const [namespace, key] = [required(rest[0], "namespace is required"), required(rest[1], "key is required")];
      validateMemory(namespace, key);
      result = {
        namespace,
        key,
        deleted: db.prepare("DELETE FROM agent_memory WHERE namespace=? AND key=?").run(namespace, key).changes > 0,
      };
      break;
    }
    case "settings-get":
      result = { settings: settingsValue() };
      break;
    case "settings-set": {
      const submitted = parseValue<Record<string, any>>(rest[0]);
      const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
      if (Object.keys(submitted).some((key) => !allowed.has(key))) throw new Error("unknown settings");
      const set = db.prepare(
        "INSERT INTO settings(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
      );
      db.transaction(() => {
        for (let [key, value] of Object.entries(submitted)) {
          if (["sync_days", "initial_sync_limit"].includes(key))
            value = Math.max(1, Math.min(Number(value), key === "sync_days" ? 3650 : 10_000));
          else if (
            [
              "sync_on_start",
              "auto_organize",
              "agent_delegation",
              "allow_remote_images",
              "share_message_content",
            ].includes(key)
          )
            value = Boolean(value);
          else if (["agent_provider", "agent_model"].includes(key)) value = String(value).slice(0, 200);
          else if (
            key === "agent_thinking" &&
            !["off", "minimal", "low", "medium", "high", "xhigh"].includes(String(value))
          )
            throw new Error("invalid thinking level");
          set.run(key, JSON.stringify(value));
        }
      })();
      result = { settings: settingsValue() };
      break;
    }
    case "agent-key-set": {
      const provider = required(rest[0], "provider is required"),
        key = rest[1] || "";
      if (!/^[a-z0-9_-]{2,80}$/.test(provider)) throw new Error("invalid provider");
      if (key)
        db.prepare(
          "INSERT INTO agent_credentials(provider,api_key,updated_at) VALUES(?,?,?) ON CONFLICT(provider) DO UPDATE SET api_key=excluded.api_key,updated_at=excluded.updated_at",
        ).run(provider, key, now());
      else db.prepare("DELETE FROM agent_credentials WHERE provider=?").run(provider);
      result = { provider, configured: Boolean(key) };
      break;
    }
    case "agent-keys":
      result = { credentials: db.prepare("SELECT provider,updated_at FROM agent_credentials ORDER BY provider").all() };
      break;
    case "agent-key-values":
      result = { credentials: db.prepare("SELECT provider,api_key FROM agent_credentials").all() };
      break;
    case "session-start": {
      const value = parseValue<any>(rest[0]),
        id = String(value.id || "");
      if (!/^[A-Za-z0-9-]{8,100}$/.test(id)) throw new Error("invalid session id");
      const timestamp = now(),
        historyKind = value.kind === "job" ? "job" : "agent",
        status = value.status === "running" ? "running" : "ready";
      db.prepare(
        "INSERT INTO agent_sessions(id,title,history_kind,model_provider,model_id,status,started_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        id,
        String(value.title || (historyKind === "job" ? "Background job" : "Agent session")).slice(0, 200),
        historyKind,
        value.provider || null,
        value.model || null,
        status,
        timestamp,
        timestamp,
      );
      result = { id, history_kind: historyKind };
      break;
    }
    case "session-event": {
      const value = parseValue<any>(rest[0]);
      const id = String(value.session_id || ""),
        timestamp = now(),
        metadata = value.metadata && typeof value.metadata === "object" ? value.metadata : {};
      db.transaction(() => {
        db.prepare(
          "INSERT INTO agent_events(session_id,event_type,role,content,metadata_json,created_at) VALUES(?,?,?,?,?,?)",
        ).run(
          id,
          String(value.event_type || "event").slice(0, 80),
          value.role || null,
          String(value.content || "").slice(0, 100_000),
          JSON.stringify(metadata),
          timestamp,
        );
        if (value.status)
          db.prepare("UPDATE agent_sessions SET status=?,updated_at=?,error=? WHERE id=?").run(
            value.status,
            timestamp,
            value.error || null,
            id,
          );
        else db.prepare("UPDATE agent_sessions SET updated_at=? WHERE id=?").run(timestamp, id);
      })();
      result = { saved: true };
      break;
    }
    case "session-list":
      result = {
        sessions: db
          .prepare(
            `SELECT s.*,(SELECT COUNT(*) FROM agent_events e WHERE e.session_id=s.id) event_count,(SELECT content FROM agent_events e WHERE e.session_id=s.id AND e.event_type='user_prompt' ORDER BY e.id LIMIT 1) first_prompt FROM agent_sessions s ORDER BY s.updated_at DESC LIMIT 50`,
          )
          .all(),
      };
      break;
    case "session-get":
      result = sessionGet(required(rest[0], "session id is required"));
      break;
    case "sessions-interrupt-running": {
      const info = db
        .prepare("UPDATE agent_sessions SET status='error',updated_at=?,error=? WHERE status='running'")
        .run(now(), "Application restarted before this run completed");
      result = { interrupted: info.changes };
      break;
    }
    case "propose": {
      const action = required(rest[0], "action is required"),
        items = parseValue<any[]>(rest[1]);
      if (
        !["archive", "move", "delete"].includes(action) ||
        !Array.isArray(items) ||
        !items.length ||
        items.length > 100
      )
        throw new Error("invalid action or items");
      for (const item of items) {
        if (!item?.account || !/^\d+$/.test(String(item.uid || ""))) throw new Error("invalid action item");
        if (!db.prepare("SELECT 1 FROM messages WHERE account=? AND uid=?").get(item.account, String(item.uid)))
          throw new Error("proposal contains a message that is not in the local cache");
        if (action === "move" && (!item.folder || !knownMoveDestination(item.account, item.folder)))
          throw new Error("move destination was not found as a selectable IMAP folder");
      }
      const reason = option(rest, "--reason");
      const info = db
        .prepare("INSERT INTO actions(action,items_json,reason,created_at) VALUES(?,?,?,?)")
        .run(action, JSON.stringify(items), reason, now());
      result = { id: Number(info.lastInsertRowid), action, status: "proposed", items, reason };
      break;
    }
    case "apply": {
      const id = Number(required(rest[0], "proposal id is required")),
        row = db.prepare("SELECT * FROM actions WHERE id=?").get(id) as any;
      if (row?.status !== "proposed") throw new Error("action is missing or not pending");
      const applied = await applyMailboxAction(row.action, json(row.items_json, []));
      db.prepare("UPDATE actions SET status=?,applied_at=? WHERE id=?").run(applied.status, now(), id);
      result = { id, ...applied };
      break;
    }
    default:
      throw new Error(`unknown store command: ${command || "(empty)"}`);
  }
  return result as T;
}
