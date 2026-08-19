export type ConversationSnapshot = {
  sessionId?: string;
  entries: unknown[];
};

const STORAGE_KEY = "email-agent:conversation:v1";

export function loadConversationSnapshot(): ConversationSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!value || !Array.isArray(value.entries)) return null;
    return {
      sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
      entries: value.entries.slice(-100),
    };
  } catch {
    return null;
  }
}

export function saveConversationSnapshot(value: ConversationSnapshot) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...value, entries: value.entries.slice(-100) }));
  } catch {
    // The SQLite history remains the authoritative fallback if browser storage is full.
  }
}

export function clearConversationSnapshot() {
  if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
}
