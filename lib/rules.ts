import { accountByName, db, json, now, queryMessages } from "@/lib/database";
import { type FolderMutation, isProtectedMailbox, validateMailboxPath } from "@/lib/imap-folder";
import { providerForHost } from "@/lib/mail-provider";

export type EmailRule = {
  id: number;
  name: string;
  account: string;
  query: string;
  action: "archive" | "move" | "delete";
  target_folder: string | null;
  status: "suggested" | "draft" | "active" | "paused";
  enabled: boolean;
  source: "manual" | "agent";
  rationale: string;
  created_at: string;
  updated_at: string;
  last_matched?: number | null;
};

function ruleRow(row: any): EmailRule | null {
  return row ? { ...row, enabled: Boolean(row.enabled) } : null;
}

export function getRule(id: number) {
  const rule = ruleRow(db.prepare("SELECT * FROM email_rules WHERE id=?").get(id));
  if (!rule) throw new Error("unknown rule");
  return rule;
}

export function listRules() {
  return (db.prepare("SELECT * FROM email_rules ORDER BY enabled DESC,updated_at DESC,id DESC").all() as any[]).map(
    ruleRow,
  ) as EmailRule[];
}

export function knownMoveDestination(account: string, folder: string) {
  const row = db
    .prepare(
      "SELECT f.path,f.special_use,f.flags_json,a.host FROM imap_folders f JOIN email_accounts a ON a.name=f.account WHERE f.account=? AND f.path=?",
    )
    .get(account, folder) as any;
  if (!row) return false;
  return !isProtectedMailbox(
    { path: row.path, special_use: row.special_use, flags: json<string[]>(row.flags_json, []) },
    providerForHost(row.host),
  );
}

export function saveRule(value: any) {
  if (!value || typeof value !== "object") throw new Error("invalid rule");
  const id = value.id ? Number(value.id) : null;
  const existing = id ? ruleRow(db.prepare("SELECT * FROM email_rules WHERE id=?").get(id)) : null;
  if (id && !existing) throw new Error("unknown rule");
  const name = String(value.name ?? existing?.name ?? "")
    .trim()
    .slice(0, 160);
  const account = String(value.account ?? existing?.account ?? "all");
  const query = String(value.query ?? existing?.query ?? "")
    .trim()
    .slice(0, 200);
  const action = String(value.action ?? existing?.action ?? "archive");
  const targetFolder = action === "move" ? String(value.target_folder ?? existing?.target_folder ?? "") : null;
  if (!name || !query || !["archive", "move", "delete"].includes(action))
    throw new Error("rule name, query, and action are required");
  if (account !== "all" && !accountByName(account)) throw new Error("unknown rule account");
  if (action === "move" && (account === "all" || !targetFolder || !knownMoveDestination(account, targetFolder))) {
    throw new Error("move flows require one account and a discovered selectable folder");
  }
  const requestedStatus = String(value.status);
  const status = ["suggested", "draft", "active", "paused"].includes(requestedStatus)
    ? requestedStatus
    : existing?.status || "draft";
  const enabled = value.enabled === undefined ? Boolean(existing?.enabled) : Boolean(value.enabled);
  const source = value.source === "agent" ? "agent" : existing?.source || "manual";
  const rationale = String(value.rationale ?? existing?.rationale ?? "").slice(0, 2_000);
  const timestamp = now();
  if (existing) {
    db.prepare(
      "UPDATE email_rules SET name=?,account=?,query=?,action=?,target_folder=?,status=?,enabled=?,source=?,rationale=?,updated_at=? WHERE id=?",
    ).run(
      name,
      account,
      query,
      action,
      targetFolder,
      enabled ? "active" : status === "active" ? "paused" : status,
      Number(enabled),
      source,
      rationale,
      timestamp,
      id,
    );
    return getRule(id!);
  }
  const info = db
    .prepare(
      "INSERT INTO email_rules(name,account,query,action,target_folder,status,enabled,source,rationale,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(name, account, query, action, targetFolder, status, Number(enabled), source, rationale, timestamp, timestamp);
  return getRule(Number(info.lastInsertRowid));
}

export function saveAgentSuggestedRule(value: any) {
  if (value?.id) throw new Error("Use the authorized Flow update tool to edit an existing definition");
  return db
    .transaction(() => {
      const account = String(value?.account || "all");
      const query = String(value?.query || "")
        .trim()
        .slice(0, 200);
      const existing = db
        .prepare("SELECT id FROM email_rules WHERE account=? AND query=? ORDER BY id LIMIT 1")
        .get(account, query) as { id: number } | undefined;
      if (existing)
        throw new Error(
          `Flow ${existing.id} already exists for this account/query. Inspect and reuse it, or update it if selected/conversation-created. Do not create a replacement when an edit is denied.`,
        );
      return saveRule({ ...value, source: "agent", status: "suggested", enabled: false });
    })
    .immediate();
}

export function deleteRule(id: number) {
  return db.prepare("DELETE FROM email_rules WHERE id=?").run(id).changes > 0;
}

export function previewRule(id: number, offset: number, limit: number) {
  const rule = getRule(id);
  return {
    rule,
    ...queryMessages({ account: rule.account, query: rule.query, limit, offset, includeBodyFetched: true }),
  };
}

export function prepareRuleProposal(id: number) {
  const rule = getRule(id);
  const matches = queryMessages({ account: rule.account, query: rule.query, limit: 100 });
  if (!matches.messages.length) throw new Error("rule has no current matches");
  const items = (matches.messages as Array<{ account: string; uid: string; folder: string }>).map((message) => ({
    account: message.account,
    uid: message.uid,
    source_folder: message.folder,
    ...(rule.action === "move" ? { folder: rule.target_folder || undefined } : {}),
  }));
  return { rule, matched: matches.total, items };
}

export function markRuleMatched(id: number, count: number) {
  db.prepare("UPDATE email_rules SET last_matched=?,updated_at=? WHERE id=?").run(count, now(), id);
}

export function reconcileFolderRules(account: string, mutation: FolderMutation, delimiter: string) {
  if (mutation.action === "create") return;
  const path = validateMailboxPath(mutation.path);
  const prefix = `${path}${delimiter}`;
  const affected = (
    db.prepare("SELECT id,target_folder FROM email_rules WHERE account=? AND action='move'").all(account) as any[]
  ).filter((rule) => rule.target_folder === path || String(rule.target_folder || "").startsWith(prefix));
  const timestamp = now();
  if (mutation.action === "rename") {
    const newPath = validateMailboxPath(mutation.new_path, "new folder path");
    const update = db.prepare("UPDATE email_rules SET target_folder=?,updated_at=? WHERE id=?");
    db.transaction(() => {
      affected.forEach((rule) => {
        update.run(`${newPath}${String(rule.target_folder).slice(path.length)}`, timestamp, rule.id);
      });
    })();
  } else {
    const pause = db.prepare("UPDATE email_rules SET enabled=0,status='paused',updated_at=? WHERE id=?");
    db.transaction(() => {
      affected.forEach((rule) => {
        pause.run(timestamp, rule.id);
      });
    })();
  }
}
