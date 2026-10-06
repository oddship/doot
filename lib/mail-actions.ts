export type MailAction = "mark_read" | "archive" | "move" | "delete";
export function normalizeMailActions(value: unknown, fallback: string = "archive"): MailAction[] {
  const actions = value === undefined ? [fallback] : value;
  if (
    !Array.isArray(actions) ||
    !actions.length ||
    actions.length > 2 ||
    actions.some((action) => !["mark_read", "archive", "move", "delete"].includes(action)) ||
    new Set(actions).size !== actions.length
  )
    throw new Error("Choose valid Flow actions: mark_read, archive, move, or delete");
  if (actions.length === 2 && (actions[0] !== "mark_read" || actions[1] === "mark_read"))
    throw new Error("Mark as read must come first, followed by one archive, move, or delete action");
  return actions;
}
export function ruleActionFingerprint(value: {
  account: string;
  query: string;
  action: string;
  actions?: MailAction[];
  target_folder?: string | null;
}) {
  return JSON.stringify([
    value.account,
    value.query,
    normalizeMailActions(value.actions, value.action),
    value.target_folder || null,
  ]);
}
export function mailActionLabel(value: { action: string; actions?: MailAction[]; target_folder?: string | null }) {
  return normalizeMailActions(value.actions, value.action)
    .map((action) =>
      action === "mark_read"
        ? "Mark as read"
        : action === "move"
          ? `Move to ${value.target_folder || "destination"}`
          : action === "archive"
            ? "Archive"
            : "Delete",
    )
    .join(" → ");
}
