import { readAppState, writeAppState } from "@/lib/client-app-state";
export type SelectedDraftRef = { id: number; title: string };

const STORAGE_KEY = "doot:selected-draft:v1";
export const DRAFT_SELECTION_EVENT = "doot-draft-selection";

export function loadSelectedDraft(): SelectedDraftRef | null {
  if (typeof window === "undefined") return null;
  try {
    const value = readAppState(STORAGE_KEY);
    return value && Number.isSafeInteger(value.id) && value.id > 0 && typeof value.title === "string"
      ? { id: value.id, title: value.title.slice(0, 200) }
      : null;
  } catch {
    return null;
  }
}

export function saveSelectedDraft(value: SelectedDraftRef | null) {
  if (typeof window === "undefined") return;
  writeAppState(STORAGE_KEY, value ? { id: value.id, title: value.title.slice(0, 200) } : null);
  window.dispatchEvent(new CustomEvent(DRAFT_SELECTION_EVENT, { detail: value }));
}
