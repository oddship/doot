"use client";
import { MailCheck, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Artifact,
  Conversation,
  ConversationEmpty,
  Message,
  PromptInput,
  Reasoning,
  TaskStatus,
  ToolCall,
} from "@/components/ai-elements";
import { WorkspaceBoundary } from "@/components/generated-workspace";
import { Badge, Button } from "@/components/ui";
import {
  clearConversationSnapshot,
  loadConversationSnapshot,
  saveConversationSnapshot,
} from "@/lib/client-conversation";
import {
  loadSelectedRule,
  RULE_SELECTION_EVENT,
  type SelectedRuleRef,
  saveSelectedRule,
} from "@/lib/client-rule-selection";
import { loadSelectedRefs, SELECTION_EVENT } from "@/lib/client-selection";

export type WorkspaceEntry = {
  role?: "user" | "assistant" | "system";
  text?: string;
  reasoning?: string;
  tools?: Array<{ id: string; name: string; state: "running" | "complete" | "error"; detail?: string }>;
  status?: { status: string; detail: string };
  artifact?: any;
  rule?: any;
};

function replayLastTurn(entries: WorkspaceEntry[], data: any): WorkspaceEntry[] {
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
  turn.forEach((event: any, index: number) => {
    if (event.event_type === "tool_start")
      tools.set(`${event.content}-${index}`, {
        id: `${event.content}-${index}`,
        name: event.content,
        state: "running",
        detail: event.metadata?.args ? JSON.stringify(event.metadata.args) : undefined,
      });
    if (event.event_type === "tool_end") {
      const match = [...tools.entries()]
        .reverse()
        .find(([, tool]) => tool.name === event.content && tool.state === "running");
      if (match)
        tools.set(match[0], {
          ...match[1],
          state: event.metadata?.is_error ? "error" : "complete",
          detail: event.metadata?.summary || match[1].detail,
        });
    }
  });
  const status = data?.session?.status || "complete";
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

export function WorkspaceClient({
  initialWorkspace,
  initialEntries = [],
  backgroundUpdates = true,
}: {
  initialWorkspace: any;
  initialEntries?: WorkspaceEntry[];
  backgroundUpdates?: boolean;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace?.legacy || initialWorkspace);
  const [entries, setEntries] = useState<WorkspaceEntry[]>(initialEntries);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedRule, setSelectedRule] = useState<SelectedRuleRef | null>(null);
  const [conversationReady, setConversationReady] = useState(false);
  const [conversationSessionId, setConversationSessionId] = useState<string | undefined>(undefined);
  const session = useRef<string | undefined>(undefined);
  const setSessionId = (id: string | undefined) => {
    session.current = id;
    setConversationSessionId(id);
  };
  useEffect(() => {
    const saved = initialEntries.length ? null : loadConversationSnapshot();
    if (saved) {
      setEntries(saved.entries as WorkspaceEntry[]);
      setSessionId(saved.sessionId);
    }
    setConversationReady(true);
  }, []);
  useEffect(() => {
    if (conversationReady) saveConversationSnapshot({ sessionId: conversationSessionId, entries });
  }, [conversationReady, conversationSessionId, entries]);
  useEffect(() => {
    const refresh = () => setSelectedCount(loadSelectedRefs().length);
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(SELECTION_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SELECTION_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    const refresh = () => setSelectedRule(loadSelectedRule());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(RULE_SELECTION_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(RULE_SELECTION_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    if (!backgroundUpdates) return;
    let disposed = false;
    const refreshWorkspace = async () => {
      const response = await fetch("/api/workspaces/latest", {
        cache: "no-store",
      });
      if (!response.ok || disposed) return;
      const value = await response.json();
      if (value.workspace?.compatible && value.workspace.spec) setWorkspace(value.workspace.spec);
    };
    const refreshRun = async () => {
      let latest: any;
      let detail: any;
      if (session.current) {
        const response = await fetch(`/api/agent/sessions/${encodeURIComponent(session.current)}`, {
          cache: "no-store",
        });
        if (!response.ok || disposed) return;
        detail = await response.json();
        latest = detail.session;
      } else {
        const response = await fetch("/api/agent/sessions", { cache: "no-store" });
        if (!response.ok || disposed) return;
        latest = (await response.json()).sessions?.find(
          (item: any) => item.status === "running" && item.history_kind !== "job",
        );
      }
      if (!latest || disposed) return;
      if (latest.status === "running") {
        setSessionId(latest.id);
        setRunning(true);
        setEntries((old) =>
          old.length
            ? old
            : [
                {
                  role: "assistant",
                  status: {
                    status: "running",
                    detail: "Reattached to Doot, still working in the background…",
                  },
                },
              ],
        );
      } else if (session.current === latest.id) {
        setRunning(false);
        setEntries((old) => (detail ? replayLastTurn(old, detail) : old));
        if (latest.status === "complete") await refreshWorkspace();
      }
    };
    void refreshWorkspace();
    void refreshRun();
    const socket = new WebSocket(`ws://${location.host}/ws`);
    socket.onmessage = (event) => {
      const value = JSON.parse(event.data);
      if (value.type === "cache.refresh" && (value.resource === "all" || value.resource === "workspaces")) {
        void refreshWorkspace();
        void refreshRun();
      }
    };
    const refreshVisibleRun = () => {
      if (document.visibilityState === "visible") void refreshRun();
    };
    document.addEventListener("visibilitychange", refreshVisibleRun);
    const poll = setInterval(refreshVisibleRun, 2_000);
    return () => {
      disposed = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refreshVisibleRun);
      socket.close();
    };
  }, [backgroundUpdates]);
  const run = async (text: string, organize = false) => {
    if (running) return;
    setRunning(true);
    setEntries((old) => [
      ...old,
      { role: "user", text: organize ? "Organize my inboxes" : text },
      {
        role: "assistant",
        text: "",
        reasoning: "",
        tools: [],
        status: { status: "running", detail: "Preparing Doot’s workspace…" },
      },
    ]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          organize,
          sessionId: session.current,
          selected: loadSelectedRefs(),
          selectedRule: loadSelectedRule(),
        }),
      });
      if (!response.ok || !response.body) throw new Error((await response.json()).error || "Doot request failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((part) => part.startsWith("data: "));
          if (!line || line === "data: [DONE]") continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "data-rule") {
            const currentRule = loadSelectedRule();
            if (currentRule?.id === event.data?.id) saveSelectedRule({ id: event.data.id, name: event.data.name });
          }
          if (event.type === "start" && event.messageMetadata?.sessionId) setSessionId(event.messageMetadata.sessionId);
          setEntries((old) => {
            const next = [...old];
            const current = { ...next[next.length - 1] };
            if (event.type === "text-delta") current.text = (current.text || "") + event.delta;
            if (event.type === "reasoning-delta") current.reasoning = (current.reasoning || "") + event.delta;
            if (event.type === "tool-input-start")
              current.tools = [
                ...(current.tools || []),
                { id: event.toolCallId, name: event.toolName, state: "running" as const, detail: event.inputSummary },
              ];
            if (event.type === "tool-output-available")
              current.tools = (current.tools || []).map((tool) =>
                tool.id === event.toolCallId
                  ? {
                      ...tool,
                      state: event.isError ? ("error" as const) : ("complete" as const),
                      detail: event.summary || tool.detail,
                    }
                  : tool,
              );
            if (event.type === "data-status") current.status = event.data;
            if (event.type === "data-artifact") current.artifact = event.data;
            if (event.type === "data-rule") current.rule = event.data;
            if (event.type === "error") current.status = { status: "error", detail: event.errorText };
            next[next.length - 1] = current;
            return next;
          });
          if (event.type === "data-workspace") setWorkspace(event.data.spec);
        }
      }
    } catch (error: any) {
      setEntries((old) => {
        const next = [...old];
        next[next.length - 1] = {
          ...next[next.length - 1],
          status: { status: "error", detail: String(error?.message || error) },
        };
        return next;
      });
    } finally {
      setRunning(false);
    }
  };
  const newConversation = () => {
    if (running) return;
    setSessionId(undefined);
    setEntries([]);
    setPrompt("");
    clearConversationSnapshot();
  };
  return (
    <main className="workspace-shell">
      <section className="agent-pane">
        <div className="pane-head">
          <div>
            <h1>Doot</h1>
            <span className="muted">दूत · local inbox emissary · approval-only actions</span>
          </div>
          <div className="pane-actions">
            {selectedCount > 0 && (
              <Badge tone="selected" title="These emails will be included as Doot context">
                <MailCheck size={14} />
                {selectedCount} email{selectedCount === 1 ? "" : "s"} selected
              </Badge>
            )}
            {selectedRule && (
              <div className="selected-rule-context">
                <Badge tone="selected" title="This flow will be included as Doot context">
                  <Sparkles size={14} />
                  Flow: {selectedRule.name}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear selected flow"
                  onClick={() => saveSelectedRule(null)}
                >
                  <X size={14} />
                </Button>
              </div>
            )}
            <Button variant="outline" size="sm" disabled={running} onClick={newConversation}>
              <Plus size={14} />
              New conversation
            </Button>
            <Badge tone={running ? "attention" : "good"}>{running ? "Running" : "Ready"}</Badge>
          </div>
        </div>
        <Conversation>
          {entries.length === 0 && <ConversationEmpty />}
          {entries.map((entry, index) => (
            <div key={index}>
              {entry.role && (
                <Message role={entry.role}>
                  {entry.reasoning !== undefined && (
                    <Reasoning text={entry.reasoning} active={running && index === entries.length - 1} />
                  )}
                  {entry.tools?.map((tool, toolIndex) => (
                    <ToolCall key={toolIndex} {...tool} />
                  ))}
                  {entry.text && <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{entry.text}</p>}
                  {entry.artifact && (
                    <Artifact title={entry.artifact.title}>
                      <p>Saved locally as {entry.artifact.kind}.</p>
                    </Artifact>
                  )}
                  {entry.rule && (
                    <Artifact title={entry.rule.name}>
                      <p>
                        Saved as a disabled flow suggestion. <a href={`/flows/${entry.rule.id}`}>Review flow</a>
                      </p>
                    </Artifact>
                  )}
                </Message>
              )}
              {entry.status && <TaskStatus {...entry.status} />}
            </div>
          ))}
        </Conversation>
        <div className="prompt-wrap">
          <div style={{ display: "flex", gap: 8, marginBottom: 9 }}>
            <Button onClick={() => run("", true)} disabled={running}>
              <Sparkles size={16} />
              Organize
            </Button>
            <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>
              {selectedRule
                ? `Ask Doot to refine, rename, or change the action for “${selectedRule.name}”`
                : selectedCount
                  ? `${selectedCount} selected email${selectedCount === 1 ? "" : "s"} will be included as context`
                  : "Runs only when you ask"}
            </span>
          </div>
          <PromptInput
            value={prompt}
            onChange={setPrompt}
            disabled={running}
            onSubmit={() => {
              const value = prompt.trim();
              if (value) {
                setPrompt("");
                void run(value);
              }
            }}
          />
        </div>
      </section>
      <section className="canvas-pane">
        {workspace ? (
          <WorkspaceBoundary value={workspace} />
        ) : (
          <div className="canvas-empty">
            <div>
              <Sparkles size={28} />
              <h2>Your generated workspace appears here</h2>
              <p>
                Doot can arrange cached mail into safe metrics, clusters, tables, suggestions, and reviewable actions.
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
