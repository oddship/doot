export type SelectedDraftRef = { id: number; title: string };

const STORAGE_KEY = "doot:selected-draft:v1";
export const DRAFT_SELECTION_EVENT = "doot-draft-selection";

export function loadSelectedDraft(): SelectedDraftRef | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return value && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.title === "string"
      ? { id: value.id, title: value.title.slice(0, 200) }
      : null;
  } catch {
    return null;
  }
}

export function saveSelectedDraft(value: SelectedDraftRef | null) {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: value.id, title: value.title.slice(0, 200) }));
  else localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(DRAFT_SELECTION_EVENT, { detail: value }));
}
