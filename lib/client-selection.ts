export type SelectedMessageRef = { account: string; uid: string; folder?: string };

const STORAGE_KEY = "email-agent:selected-messages:v1";
export const SELECTION_EVENT = "email-agent-selection";

const SEPARATOR = "\u001f";

export function selectedMessageId(reference: SelectedMessageRef) {
  return [reference.account, reference.folder || "", reference.uid].join(SEPARATOR);
}

export function selectedMessageRef(id: string): SelectedMessageRef | null {
  if (id.includes(SEPARATOR)) {
    const [account, folder, uid, ...extra] = id.split(SEPARATOR);
    if (!extra.length && account && /^\d+$/.test(uid)) return { account, uid, ...(folder ? { folder } : {}) };
    return null;
  }
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
            values.filter((value): value is string => typeof value === "string" && selectedMessageRef(value) !== null),
          ),
        ].slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

export function saveSelectedIds(values: string[]) {
  if (typeof window === "undefined") return;
  const safe = [...new Set(values)].filter((value) => selectedMessageRef(value) !== null).slice(0, 100);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  window.dispatchEvent(new CustomEvent(SELECTION_EVENT, { detail: safe }));
}

export function loadSelectedRefs() {
  return loadSelectedIds()
    .map(selectedMessageRef)
    .filter((value): value is SelectedMessageRef => value !== null);
}
