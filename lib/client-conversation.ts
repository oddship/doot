import { readAppState, writeAppState } from "@/lib/client-app-state";
import { visibleUserPrompt } from "@/lib/history-display";
import { toolInputSummary } from "@/lib/tool-presentation";

export type ReadApproval = {
  id: string;
  reason: string;
  scope?: { account: string; query: string; total: number };
  messages: Array<{ account: string; uid: string; folder?: string; sender?: string; subject?: string }>;
  status?: "pending" | "approved" | "denied";
};

export type WorkspaceEntry = {
  role?: "user" | "assistant" | "system";
  text?: string;
  reasoning?: string;
  tools?: Array<{ id: string; name: string; state: "running" | "complete" | "error"; detail?: string }>;
  status?: { status: string; detail: string };
  artifact?: any;
  rule?: any;
  readApproval?: ReadApproval;
};

export type ConversationSnapshot = {
  sessionId?: string;
  entries: unknown[];
};

export function applyConversationToolEvent(tools: NonNullable<WorkspaceEntry["tools"]>, event: any) {
  const existing = tools.find((tool) => tool.id === event.toolCallId);
  const next =
    event.type === "tool-input-start"
      ? {
          id: event.toolCallId,
          name: event.toolName,
          state: existing?.state || ("running" as const),
          detail: existing?.state && existing.state !== "running" ? existing.detail : event.inputSummary,
        }
      : {
          id: event.toolCallId,
          name: existing?.name || event.toolName || "Tool",
          state: event.isError ? ("error" as const) : ("complete" as const),
          detail: event.summary || existing?.detail,
        };
  return existing ? tools.map((tool) => (tool.id === next.id ? next : tool)) : [...tools, next];
}

const STORAGE_KEY = "email-agent:conversation:v1";

export function loadConversationSnapshot(): ConversationSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const value = readAppState(STORAGE_KEY);
    if (!value) return null;
    return {
      sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
      entries: Array.isArray(value.entries) ? value.entries.slice(-100) : [],
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
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    writeAppState(STORAGE_KEY, null);
  }
}

export function replayLastTurn(entries: WorkspaceEntry[], data: any): WorkspaceEntry[] {
  const events = Array.isArray(data?.events) ? data.events : [];
  let promptIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.event_type === "user_prompt") {
      promptIndex = index;
      break;
    }
  }
  const turn = promptIndex >= 0 ? events.slice(promptIndex + 1) : events;
  const text = turn
    .filter((event: any) => event.event_type === "assistant_message" && event.content)
    .map((event: any) => event.content)
    .join("\n\n");
  const reasoning = turn
    .filter((event: any) => event.event_type === "reasoning" && event.content)
    .map((event: any) => event.content)
    .join("\n\n");
  const tools = new Map<string, NonNullable<WorkspaceEntry["tools"]>[number]>();
  // Durable history can record a result before its start. Build starts first,
  // then reconcile results by the same IDs used by the live stream.
  turn.forEach((event: any, index: number) => {
    if (event.event_type !== "tool_start") return;
    const id = event.metadata?.tool_call_id || `${event.content}-${index}`;
    tools.set(id, {
      id,
      name: event.content,
      state: "running",
      detail: toolInputSummary(event.content, event.metadata?.args),
    });
  });
  turn.forEach((event: any) => {
    if (event.event_type !== "tool_end") return;
    const id = event.metadata?.tool_call_id;
    const match = id
      ? tools.get(id)
      : [...tools.values()].find((tool) => tool.name === event.content && tool.state === "running");
    if (!match) return;
    tools.set(match.id, {
      ...match,
      state: event.metadata?.is_error ? "error" : "complete",
      detail: event.metadata?.summary || (event.metadata?.is_error ? "Failed — open History for details" : "Completed"),
    });
  });
  const status = data?.session?.status || "complete";
  if (status !== "running") {
    for (const tool of tools.values()) {
      if (tool.state === "running") {
        tool.state = "error";
        tool.detail = "No saved result — open History for details";
      }
    }
  }
  const bodyRequest = [...turn]
    .reverse()
    .find((event: any) => event.event_type === "body_read_requested" && event.metadata?.request)?.metadata?.request;
  const decision =
    bodyRequest &&
    [...events]
      .reverse()
      .find((event: any) => event.event_type === "body_read_decided" && event.metadata?.request_id === bodyRequest.id)
      ?.metadata?.status;
  const artifact = [...turn].reverse().find((event: any) => event.event_type === "artifact_created")
    ?.metadata?.artifact;
  const rule = [...turn].reverse().find((event: any) => ["flow_created", "flow_updated"].includes(event.event_type))
    ?.metadata?.rule;
  const next = [...entries];
  let index = -1;
  for (let candidate = next.length - 1; candidate >= 0; candidate -= 1) {
    if (next[candidate]?.role === "assistant") {
      index = candidate;
      break;
    }
  }
  if (index < 0) {
    next.push({ role: "assistant" });
    index = next.length - 1;
  }
  next[index] = {
    ...next[index],
    ...(text ? { text } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(tools.size ? { tools: [...tools.values()] } : {}),
    ...(bodyRequest ? { readApproval: { ...bodyRequest, status: decision || "pending" } } : {}),
    ...(artifact ? { artifact } : {}),
    ...(rule ? { rule } : {}),
    status: {
      status,
      detail:
        status === "running"
          ? "Doot is continuing in the background…"
          : status === "complete"
            ? "Doot finished"
            : data?.session?.error || "Doot run failed",
    },
  };
  return next;
}

export function replayConversation(data: any): WorkspaceEntry[] {
  const events = Array.isArray(data?.events) ? data.events : [];
  const prompts = events
    .map((event: any, index: number) => (event.event_type === "user_prompt" ? index : -1))
    .filter((index: number) => index >= 0);
  let entries: WorkspaceEntry[] = [];
  prompts.forEach((start: number, index: number) => {
    const turn = events.slice(start, prompts[index + 1] ?? events.length);
    entries.push({ role: "user", text: visibleUserPrompt(events[start].content) }, { role: "assistant" });
    entries = replayLastTurn(entries, {
      events: turn,
      session: { ...data.session, status: index === prompts.length - 1 ? data.session.status : "complete" },
    });
  });
  return entries;
}
