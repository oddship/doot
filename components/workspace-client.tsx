"use client";
import { ArrowRight, Eye, FilePenLine, MailCheck, Pencil, Plus, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useToast } from "@/components/feedback";
import { WorkspaceBoundary } from "@/components/generated-workspace";
import { MarkdownContent } from "@/components/markdown-content";
import { ResponsiveDetails } from "@/components/responsive-details";
import { Badge, Button } from "@/components/ui";
import { consumeAgentHandoff } from "@/lib/client-agent-handoff";
import { flushAppStateWrites, readAppState, writeAppState } from "@/lib/client-app-state";
import {
  applyConversationToolEvent,
  clearConversationSnapshot,
  conversationRevision,
  loadConversationSnapshot,
  type ReadApproval,
  replayLastTurn,
  saveConversationSnapshot,
  type WorkspaceEntry,
} from "@/lib/client-conversation";
import {
  DRAFT_SELECTION_EVENT,
  loadSelectedDraft,
  type SelectedDraftRef,
  saveSelectedDraft,
} from "@/lib/client-draft-selection";
import { navigateClient } from "@/lib/client-navigation";
import {
  loadSelectedRule,
  RULE_SELECTION_EVENT,
  type SelectedRuleRef,
  saveSelectedRule,
} from "@/lib/client-rule-selection";
import {
  loadSelectedSearch,
  SEARCH_SELECTION_EVENT,
  type SelectedSearchRef,
  saveSelectedSearch,
} from "@/lib/client-search-selection";
import { loadSelectedRefs, SELECTION_EVENT } from "@/lib/client-selection";
import { useCacheEvents } from "@/lib/use-cache-events";

export type { WorkspaceEntry } from "@/lib/client-conversation";

export type AgentModelSummary = {
  provider?: string;
  id?: string;
  name?: string;
};

const MISSING_PROVIDER_ERROR = "Connect a model provider in Settings before starting an Agent conversation.";

function AgentTaskStatus({ status, detail }: { status: string; detail: string }) {
  const linksToSettings = detail.includes(MISSING_PROVIDER_ERROR);
  return (
    <TaskStatus
      status={status}
      detail={
        linksToSettings ? (
          <button type="button" className="task-status-link" onClick={() => navigateClient("/settings#agent")}>
            {detail}
          </button>
        ) : (
          detail
        )
      }
    />
  );
}

function ArtifactReviewLink({ href, label, tooltip }: { href: string; label: string; tooltip: string }) {
  return (
    <a
      className="button button-outline button-sm artifact-review-link"
      href={href}
      data-tooltip={tooltip}
      data-tooltip-side="top"
      aria-description={tooltip}
    >
      {label}
      <ArrowRight size={14} aria-hidden="true" />
    </a>
  );
}

export function WorkspaceClient({
  initialWorkspace,
  initialEntries = [],
  initialModel,
  initialSessionId,
  initialRunRevision = "",
  backgroundUpdates = true,
}: {
  initialWorkspace: any;
  initialEntries?: WorkspaceEntry[];
  initialModel?: AgentModelSummary | null;
  initialSessionId?: string;
  initialRunRevision?: string;
  backgroundUpdates?: boolean;
}) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState(initialWorkspace?.legacy || initialWorkspace);
  const [mobilePane, setMobilePane] = useState<"agent" | "workspace">("agent");
  const [entries, setEntries] = useState<WorkspaceEntry[]>(initialEntries);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedRule, setSelectedRule] = useState<SelectedRuleRef | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<SelectedDraftRef | null>(null);
  const [selectedSearch, setSelectedSearch] = useState<SelectedSearchRef | null>(null);
  const [agentModel, setAgentModel] = useState<AgentModelSummary | null>(initialModel || null);
  const [conversationReady, setConversationReady] = useState(false);
  const [conversationSessionId, setConversationSessionId] = useState<string | undefined>(initialSessionId);
  const streaming = useRef(false);
  const turnGeneration = useRef(0);
  const session = useRef<string | undefined>(initialSessionId);
  const setSessionId = (id: string | undefined) => {
    session.current = id;
    setConversationSessionId(id);
  };
  useEffect(() => {
    const saved = initialSessionId || initialEntries.length ? null : loadConversationSnapshot();
    if (saved) {
      setEntries(saved.entries as WorkspaceEntry[]);
      setSessionId(saved.sessionId);
    }
    const handoff = consumeAgentHandoff();
    if (handoff) {
      setPrompt(handoff.prompt);
      writeAppState("doot:agent-composer:v1", handoff.prompt);
    } else setPrompt(readAppState("doot:agent-composer:v1", ""));
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
    const refresh = () => setSelectedDraft(loadSelectedDraft());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(DRAFT_SELECTION_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(DRAFT_SELECTION_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    const refresh = () => setSelectedSearch(loadSelectedSearch());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener(SEARCH_SELECTION_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SEARCH_SELECTION_EVENT, refresh);
    };
  }, []);
  const runActive = useRef(running);
  const runRevision = useRef(initialRunRevision);
  const workspaceRevision = useRef(JSON.stringify(initialWorkspace?.legacy || initialWorkspace));
  const backgroundRefresh = useRef<{ run: () => void; workspace: () => void }>({ run: () => {}, workspace: () => {} });
  useEffect(() => {
    runActive.current = running;
  }, [running]);
  useCacheEvents((value) => {
    if (!backgroundUpdates || value.type !== "cache.refresh") return;
    if (value.resource === "all" || value.resource === "workspaces") void backgroundRefresh.current.workspace();
    if (value.resource === "all" || (value.resource === "history" && runActive.current))
      void backgroundRefresh.current.run();
  });
  useEffect(() => {
    if (!backgroundUpdates) return;
    let disposed = false;
    let pendingRun = false;
    let runQueued = false;
    let pendingWorkspace = false;
    let workspaceQueued = false;
    const refreshWorkspace = async () => {
      if (pendingWorkspace) {
        workspaceQueued = true;
        return;
      }
      pendingWorkspace = true;
      try {
        const response = await fetch("/api/workspaces/latest", {
          cache: "no-store",
        });
        if (!response.ok || disposed) return;
        const value = await response.json();
        if (value.workspace?.compatible && value.workspace.spec) {
          const revision = JSON.stringify(value.workspace.spec);
          if (revision !== workspaceRevision.current) {
            workspaceRevision.current = revision;
            setWorkspace(value.workspace.spec);
          }
        }
      } catch {
        /* Reconnect and visibility refresh retry persisted state. */
      } finally {
        pendingWorkspace = false;
        if (workspaceQueued && !disposed) {
          workspaceQueued = false;
          void refreshWorkspace();
        }
      }
    };
    const refreshRun = async () => {
      if (streaming.current) return;
      if (pendingRun) {
        runQueued = true;
        return;
      }
      pendingRun = true;
      try {
        const requestedSession = session.current;
        const requestedTurn = turnGeneration.current;
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
          const response = await fetch("/api/agent/sessions?running=1", { cache: "no-store" });
          if (!response.ok || disposed) return;
          latest = (await response.json()).sessions?.find(
            (item: any) => item.status === "running" && item.history_kind === "agent",
          );
        }
        if (
          !latest ||
          disposed ||
          streaming.current ||
          requestedSession !== session.current ||
          requestedTurn !== turnGeneration.current
        )
          return;
        const revision = conversationRevision(latest, detail);
        if (latest.model_provider && latest.model_id)
          setAgentModel((old) =>
            old?.provider === latest.model_provider && old?.id === latest.model_id
              ? old
              : { provider: latest.model_provider, id: latest.model_id },
          );
        if (revision === runRevision.current) return;
        runRevision.current = revision;
        if (latest.status === "running") {
          if (detail) setEntries((old) => replayLastTurn(old, detail));
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
      } catch {
        /* A transient read failure cannot change the saved run's status. */
      } finally {
        pendingRun = false;
        if (runQueued && !disposed) {
          runQueued = false;
          void refreshRun();
        }
      }
    };
    backgroundRefresh.current = { run: refreshRun, workspace: refreshWorkspace };
    void refreshRun();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && runActive.current) void refreshRun();
    }, 3000);
    return () => {
      disposed = true;
      clearInterval(poll);
      backgroundRefresh.current = { run: () => {}, workspace: () => {} };
    };
  }, [backgroundUpdates]);

  const run = async (text: string, organize = false) => {
    if (running || streaming.current) return;
    streaming.current = true;
    turnGeneration.current += 1;
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
      await flushAppStateWrites();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          commandId: crypto.randomUUID(),
          organize,
          sessionId: session.current,
          selected: loadSelectedRefs(),
          selectedRule: loadSelectedRule(),
          selectedDraft: loadSelectedDraft(),
          selectedSearch: loadSelectedSearch(),
        }),
      });
      if (!response.ok || !response.body) throw new Error((await response.json()).error || "Doot request failed");
      if (!organize) writeAppState("doot:agent-composer:v1", "");
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
          if (event.type === "data-artifact" && event.data?.kind === "draft")
            saveSelectedDraft({ id: event.data.id, title: event.data.title });
          if (event.type === "start") {
            if (event.messageMetadata?.sessionId) setSessionId(event.messageMetadata.sessionId);
            if (event.messageMetadata?.modelProvider && event.messageMetadata?.modelId)
              setAgentModel({
                provider: event.messageMetadata.modelProvider,
                id: event.messageMetadata.modelId,
              });
          }
          setEntries((old) => {
            const next = [...old];
            const current = { ...next[next.length - 1] };
            if (event.type === "text-delta") current.text = (current.text || "") + event.delta;
            if (event.type === "reasoning-delta") current.reasoning = (current.reasoning || "") + event.delta;
            if (event.type === "tool-input-start" || event.type === "tool-output-available")
              current.tools = applyConversationToolEvent(current.tools || [], event);
            if (event.type === "data-status") current.status = event.data;
            if (event.type === "data-artifact") current.artifact = event.data;
            if (event.type === "data-rule") current.rule = event.data;
            if (event.type === "data-read-approval") current.readApproval = { ...event.data, status: "pending" };
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
      streaming.current = false;
      setRunning(false);
    }
  };
  const setReadApprovalStatus = useCallback(
    (id: string, status: "approved" | "denied") =>
      setEntries((current) =>
        current.map((entry) =>
          entry.readApproval?.id === id ? { ...entry, readApproval: { ...entry.readApproval, status } } : entry,
        ),
      ),
    [],
  );
  const decideRead = useCallback(
    async (request: ReadApproval, approved: boolean) => {
      if (!session.current) return;
      try {
        const response = await fetch(`/api/agent/sessions/${session.current}/body-approvals/${request.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approved }),
        });
        if (!response.ok) throw new Error((await response.json()).error || "Could not save body approval");
        setReadApprovalStatus(request.id, approved ? "approved" : "denied");
        if (approved) setRunning(true);
      } catch (error) {
        toast.error("Could not save approval", error instanceof Error ? error.message : String(error));
      }
    },
    [setReadApprovalStatus, toast],
  );
  const approveRead = useCallback((request: ReadApproval) => void decideRead(request, true), [decideRead]);
  const newConversation = () => {
    if (running) return;
    turnGeneration.current += 1;
    setSessionId(undefined);
    setEntries([]);
    setPrompt("");
    writeAppState("doot:agent-composer:v1", "");
    setAgentModel(initialModel || null);
    clearConversationSnapshot();
  };
  const conversation = useMemo(
    () => (
      <Conversation>
        {entries.length === 0 && <ConversationEmpty />}
        {entries.map((entry, index) => (
          <div key={index}>
            {entry.role && (
              <Message role={entry.role}>
                {entry.reasoning !== undefined && (
                  <Reasoning text={entry.reasoning} active={running && index === entries.length - 1} />
                )}
                {!!entry.tools?.length && (
                  <ResponsiveDetails
                    className="tool-steps"
                    label={`${entry.tools.length} steps · ${entry.tools.some((tool) => tool.state === "error") ? "error" : entry.tools.some((tool) => tool.state === "running") ? "working" : "complete"}`}
                  >
                    {entry.tools.map((tool, toolIndex) => (
                      <ToolCall key={toolIndex} {...tool} />
                    ))}
                  </ResponsiveDetails>
                )}
                {entry.text &&
                  (entry.role === "user" ? (
                    <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{entry.text}</p>
                  ) : (
                    <MarkdownContent>{entry.text}</MarkdownContent>
                  ))}
                {entry.artifact && (
                  <Artifact title={entry.artifact.title}>
                    {entry.artifact.kind === "draft" ? (
                      <div className="artifact-review-row">
                        <span>Saved locally as a draft.</span>
                        <ArtifactReviewLink
                          href={entry.artifact.review_url || `/drafts/${entry.artifact.id}`}
                          label="Review draft"
                          tooltip="Open this draft for review"
                        />
                      </div>
                    ) : (
                      <p>Saved locally as {entry.artifact.kind}.</p>
                    )}
                  </Artifact>
                )}
                {entry.rule && (
                  <Artifact title={entry.rule.name}>
                    <div className="artifact-review-row">
                      <span>Saved as a disabled flow suggestion.</span>
                      <ArtifactReviewLink
                        href={`/flows/${entry.rule.id}`}
                        label="Review flow"
                        tooltip="Open this flow for review"
                      />
                    </div>
                  </Artifact>
                )}
                {entry.readApproval && (
                  <Artifact title="Message body access">
                    <div className="body-access-request">
                      <p>{entry.readApproval.reason}</p>
                      <p>
                        Allow Doot to read only these {entry.readApproval.messages.length} emails for analysis.
                        {entry.readApproval.scope && (
                          <>
                            {" "}
                            Search snapshot: <strong>{entry.readApproval.scope.query}</strong> in{" "}
                            {entry.readApproval.scope.account}
                            {entry.readApproval.scope.total > entry.readApproval.messages.length && (
                              <>
                                {" "}
                                ({entry.readApproval.messages.length} of {entry.readApproval.scope.total} matches)
                              </>
                            )}
                            . New matches are not included.
                          </>
                        )}
                      </p>
                      <ul>
                        {entry.readApproval.messages.map((message) => (
                          <li key={`${message.account}:${message.folder || "INBOX"}:${message.uid}`}>
                            <strong>{message.subject || "(no subject)"}</strong>
                            <span>{message.sender || `${message.account} · UID ${message.uid}`}</span>
                          </li>
                        ))}
                      </ul>
                      {entry.readApproval.status === "pending" || !entry.readApproval.status ? (
                        <div className="body-access-actions">
                          <Button
                            size="sm"
                            variant="outline"
                            tooltip="Continue without reading bodies"
                            disabled={running}
                            onClick={() => void decideRead(entry.readApproval!, false)}
                          >
                            <X size={14} /> Not now
                          </Button>
                          <Button
                            size="sm"
                            tooltip="Allow read-only analysis of only these email contents"
                            disabled={running}
                            onClick={() => approveRead(entry.readApproval!)}
                          >
                            <Eye size={14} /> Approve and continue
                          </Button>
                        </div>
                      ) : (
                        <div className={`body-access-decision ${entry.readApproval.status}`}>
                          {entry.readApproval.status === "approved" ? <ShieldCheck size={14} /> : <X size={14} />}
                          {entry.readApproval.status === "approved"
                            ? "Approved for read-only analysis"
                            : "Not approved"}
                        </div>
                      )}
                    </div>
                  </Artifact>
                )}
              </Message>
            )}
            {entry.status && <AgentTaskStatus {...entry.status} />}
          </div>
        ))}
      </Conversation>
    ),
    [entries, running, decideRead, approveRead],
  );
  const modelLabel = agentModel?.provider
    ? `${agentModel.provider} · ${agentModel.name || agentModel.id}`
    : agentModel?.name || "Automatic";
  return (
    <main className="workspace-shell" data-mobile-pane={mobilePane}>
      <fieldset className="mobile-pane-switch" aria-label="Workspace view">
        <Button
          variant={mobilePane === "agent" ? "default" : "outline"}
          aria-pressed={mobilePane === "agent"}
          aria-controls="workspace-agent"
          onClick={() => setMobilePane("agent")}
        >
          Chat
        </Button>
        <Button
          variant={mobilePane === "workspace" ? "default" : "outline"}
          aria-pressed={mobilePane === "workspace"}
          aria-controls="workspace-canvas"
          onClick={() => setMobilePane("workspace")}
        >
          Workspace
        </Button>
      </fieldset>
      <section className="agent-pane" id="workspace-agent">
        <div className="pane-head">
          <div className="pane-title">
            <h1>Email assistant</h1>
            <ResponsiveDetails label="Model" className="agent-model-details">
              <div className="agent-model-summary">
                <span>Model</span>
                <strong title={modelLabel}>{modelLabel}</strong>
                <Button
                  variant="ghost"
                  size="sm"
                  tooltip="Change model in Settings"
                  onClick={() => navigateClient("/settings#agent")}
                >
                  <Pencil size={12} /> Edit
                </Button>
              </div>
            </ResponsiveDetails>
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
                  tooltip="Remove Flow from context"
                  onClick={() => saveSelectedRule(null)}
                >
                  <X size={14} />
                </Button>
              </div>
            )}
            {selectedDraft && (
              <div className="selected-rule-context">
                <Badge tone="selected" title="This local draft will be included as Doot context">
                  <FilePenLine size={14} />
                  Draft: {selectedDraft.title}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear selected draft"
                  tooltip="Remove draft from context"
                  onClick={() => saveSelectedDraft(null)}
                >
                  <X size={14} />
                </Button>
              </div>
            )}
            {selectedSearch && (
              <div className="selected-rule-context">
                <Badge tone="selected" title="This Inbox search will be included as Doot context">
                  <Search size={14} />
                  Search: {selectedSearch.query}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear selected search"
                  tooltip="Remove search from context"
                  onClick={() => saveSelectedSearch(null)}
                >
                  <X size={14} />
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              aria-label="New conversation"
              tooltip="Start a separate agent thread"
              disabled={running}
              onClick={newConversation}
            >
              <Plus size={14} />
              <span className="new-conversation-label">New conversation</span>
            </Button>
            <Badge className="agent-run-status" data-running={running} tone={running ? "attention" : "good"}>
              {running ? "Running" : "Ready"}
            </Badge>
          </div>
        </div>
        {conversation}
        <div className="prompt-wrap">
          <div className="prompt-actions">
            <Button
              tooltip="Analyze your inbox and prepare an overview"
              tooltipSide="top"
              onClick={() => run("", true)}
              disabled={running}
            >
              <Sparkles size={16} />
              Organize
            </Button>
            {(selectedDraft || selectedRule || selectedSearch || selectedCount > 0) && (
              <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>
                {selectedDraft
                  ? `Ask Doot to compose or revise “${selectedDraft.title}”`
                  : selectedRule
                    ? `Ask Doot to refine, rename, or change the action for “${selectedRule.name}”`
                    : selectedSearch
                      ? `Ask Doot to narrow or broaden “${selectedSearch.query}”`
                      : `${selectedCount} selected email${selectedCount === 1 ? "" : "s"} will be included as context`}
              </span>
            )}
          </div>
          <PromptInput
            value={prompt}
            onChange={(value) => {
              setPrompt(value);
              writeAppState("doot:agent-composer:v1", value);
            }}
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
      <section className="canvas-pane" id="workspace-canvas">
        {workspace ? (
          <WorkspaceBoundary value={workspace} />
        ) : (
          <div className="canvas-empty">
            <div>
              <Sparkles size={28} />
              <h2>Your email overview</h2>
              <p>Choose Organize to see what needs attention, or ask Doot to find and group email for you.</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
