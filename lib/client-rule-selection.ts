export type SelectedRuleRef = { id: number; name: string };

const STORAGE_KEY = "email-agent:selected-rule:v1";
export const RULE_SELECTION_EVENT = "email-agent-rule-selection";

export function loadSelectedRule(): SelectedRuleRef | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.name === "string"
      ? { id: value.id, name: value.name.slice(0, 160) }
      : null;
  } catch {
    return null;
  }
}

export function saveSelectedRule(value: SelectedRuleRef | null) {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: value.id, name: value.name.slice(0, 160) }));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(RULE_SELECTION_EVENT, { detail: value }));
}
