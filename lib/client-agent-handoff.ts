export type AgentHandoff = { prompt: string };

const STORAGE_KEY = "doot:agent-handoff:v1";

export function saveAgentHandoff(value: AgentHandoff) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

export function consumeAgentHandoff(): AgentHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    sessionStorage.removeItem(STORAGE_KEY);
    return value && typeof value.prompt === "string" && value.prompt.trim() ? { prompt: value.prompt } : null;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}
