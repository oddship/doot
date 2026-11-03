import { db, now } from "@/lib/database";
import { normalizeMailActions } from "@/lib/mail-actions";
import { knownMoveDestination } from "@/lib/rules";

export function createMailboxProposal(input: {
  action: string;
  items: any[];
  actions?: any;
  reason?: string;
  flowId?: number;
}) {
  const { action, items, actions, reason = "" } = input;
  if (
    !["mark_read", "archive", "move", "delete"].includes(action) ||
    !Array.isArray(items) ||
    !items.length ||
    items.length > 100
  )
    throw new Error("invalid action or items");
  const plan = normalizeMailActions(actions, action);
  if (plan[plan.length - 1] !== action) throw new Error("Proposal action does not match its action sequence");
  for (const item of items) {
    if (
      !item?.account ||
      !/^\d+$/.test(String(item.uid || "")) ||
      typeof item.source_folder !== "string" ||
      !item.source_folder.trim()
    )
      throw new Error("every action item requires an exact source folder");
    if (
      !db
        .prepare("SELECT 1 FROM messages WHERE account=? AND folder=? AND uid=? AND present=1")
        .get(item.account, item.source_folder, String(item.uid))
    )
      throw new Error("proposal contains a message that is not in the local cache");
    if (action === "move" && (!item.folder || !knownMoveDestination(item.account, item.folder)))
      throw new Error("move destination was not found as a selectable IMAP folder");
  }
  const snapshot = items.map((item) => {
    const checkpoint = db
      .prepare("SELECT uid_validity FROM sync_state WHERE account=? AND folder=?")
      .get(item.account, item.source_folder) as any;
    return { ...item, ...(checkpoint?.uid_validity ? { uid_validity: String(checkpoint.uid_validity) } : {}) };
  });
  const info = db
    .prepare("INSERT INTO actions(action,items_json,reason,created_at,actions_json) VALUES(?,?,?,?,?)")
    .run(action, JSON.stringify(snapshot), reason, now(), JSON.stringify(plan));
  const id = Number(info.lastInsertRowid);
  if (input.flowId)
    db.prepare("INSERT INTO app_state(key,value_json) VALUES(?,?)").run(
      `proposal-source:${id}`,
      JSON.stringify({ flow_id: input.flowId }),
    );
  return { id, action, actions: plan, status: "proposed", items: snapshot, reason };
}
