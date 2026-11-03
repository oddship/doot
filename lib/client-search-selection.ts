import { readAppState, writeAppState } from "@/lib/client-app-state";
export type SelectedSearchRef = { account: string; query: string };

const STORAGE_KEY = "doot:selected-search:v1";
export const SEARCH_SELECTION_EVENT = "doot-search-selection";

function validate(value: unknown): SelectedSearchRef | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const account = typeof candidate.account === "string" ? candidate.account.trim().slice(0, 200) : "";
  const query = typeof candidate.query === "string" ? candidate.query.trim().slice(0, 500) : "";
  return account && query ? { account, query } : null;
}

export function loadSelectedSearch(): SelectedSearchRef | null {
  if (typeof window === "undefined") return null;
  try {
    return validate(readAppState(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveSelectedSearch(value: SelectedSearchRef | null) {
  if (typeof window === "undefined") return;
  const next = validate(value);
  writeAppState(STORAGE_KEY, next);
  window.dispatchEvent(new CustomEvent(SEARCH_SELECTION_EVENT, { detail: next }));
}
