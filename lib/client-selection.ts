export type SelectedMessageRef = { account: string; uid: string };

const STORAGE_KEY = "email-agent:selected-messages:v1";
export const SELECTION_EVENT = "email-agent-selection";

function selectionRef(id: string): SelectedMessageRef | null {
  const split = id.lastIndexOf(":");
  const account = id.slice(0, split),
    uid = id.slice(split + 1);
  return split > 0 && /^\d+$/.test(uid) ? { account, uid } : null;
}

export function loadSelectedIds() {
  if (typeof window === "undefined") return [] as string[];
  try {
    const values = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(values)
      ? [
          ...new Set(
            values.filter((value): value is string => typeof value === "string" && selectionRef(value) !== null),
          ),
        ].slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

export function saveSelectedIds(values: string[]) {
  if (typeof window === "undefined") return;
  const safe = [...new Set(values)].filter((value) => selectionRef(value) !== null).slice(0, 100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  window.dispatchEvent(new CustomEvent(SELECTION_EVENT, { detail: safe }));
}

export function loadSelectedRefs() {
  return loadSelectedIds()
    .map(selectionRef)
    .filter((value): value is SelectedMessageRef => value !== null);
}
