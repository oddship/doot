import { readAppState, writeAppState } from "@/lib/client-app-state";
export type AgentHandoff = { prompt: string };

const STORAGE_KEY = "doot:agent-handoff:v1";

export function saveAgentHandoff(value: AgentHandoff) {
  if (typeof window === "undefined") return;
  writeAppState(STORAGE_KEY, value);
}

export function consumeAgentHandoff(): AgentHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const value = readAppState(STORAGE_KEY);
    writeAppState(STORAGE_KEY, null);
    return value && typeof value.prompt === "string" && value.prompt.trim() ? { prompt: value.prompt } : null;
  } catch {
    writeAppState(STORAGE_KEY, null);
    return null;
  }
}
