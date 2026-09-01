"use client";
import { Archive, ExternalLink, FolderInput, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { Badge, Button, Card, cn } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";
import { navigateClient } from "@/lib/client-navigation";
import {
  type GeneratedWorkspace,
  generatedWorkspaceSchema,
  type WorkspaceActionIntent,
  type WorkspaceNode,
} from "@/lib/workspace";

function runIntent(intent: WorkspaceActionIntent) {
  if (intent.type === "open_message") {
    const query = new URLSearchParams({ account: intent.account, open: intent.uid });
    if (intent.folder) query.set("folder", intent.folder);
    navigateClient(`/inbox?${query}`);
    return;
  }
  if (intent.type === "filter_inbox") {
    const query = new URLSearchParams();
    if (intent.account) query.set("account", intent.account);
    if (intent.query) query.set("query", intent.query);
    navigateClient(`/inbox?${query}`);
    return;
  }
  if (intent.type === "open_artifact") {
    navigateClient(`/settings#artifact-${intent.artifactId}`);
    return;
  }
  if (intent.type === "open_rule") {
    navigateClient(`/flows/${intent.ruleId}`);
    return;
  }
  if (intent.type === "open_flow") {
    navigateClient(`/flows/${intent.flowId}`);
    return;
  }
}

function ActionButton({ action }: { action: { label: string; intent: WorkspaceActionIntent } }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const intent = action.intent;
  const help =
    intent.type === "create_proposal"
      ? "Prepare a reviewable mailbox proposal"
      : intent.type === "open_message"
        ? "Open this cached email"
        : intent.type === "filter_inbox"
          ? "Show matching cached email"
          : intent.type === "open_flow" || intent.type === "open_rule"
            ? "Open the Flow review"
            : "Open the saved artifact";
  const createProposal = async () => {
    if (intent.type !== "create_proposal") return;
    setCreating(true);
    try {
      const value = await apiJson<{ id: number }>(
        "/api/proposals",
        { method: "POST", json: intent },
        "Could not create proposal",
      );
      setConfirming(false);
      toast.success(
        "Proposal created",
        `Proposal ${value.id} is ready for review. No mailbox change has been applied.`,
      );
    } catch (error) {
      toast.error("Could not create proposal", errorMessage(error, "Please try again."));
    } finally {
      setCreating(false);
    }
  };
  return (
    <>
      <Button
        variant={intent.type === "create_proposal" && intent.action === "delete" ? "danger" : "outline"}
        size="sm"
        tooltip={help}
        onClick={() => (intent.type === "create_proposal" ? setConfirming(true) : runIntent(intent))}
      >
        {intent.type === "create_proposal" ? (
          intent.action === "archive" ? (
            <Archive size={14} />
          ) : intent.action === "delete" ? (
            <Trash2 size={14} />
          ) : (
            <FolderInput size={14} />
          )
        ) : (
          <ExternalLink size={14} />
        )}
        {action.label}
      </Button>
      {intent.type === "create_proposal" && (
        <ConfirmDialog
          open={confirming}
          title="Create review proposal?"
          description={
            <>
              <p>
                Prepare a proposal to <strong>{intent.action}</strong> {intent.items.length} message(s)?
              </p>
              <p className="muted">This creates a local review item only. No mailbox change will occur yet.</p>
            </>
          }
          confirmLabel="Create proposal"
          dangerous={intent.action === "delete"}
          busy={creating}
          onConfirm={() => void createProposal()}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function isFlowSuggestion(node: WorkspaceNode) {
  return node.type === "rule_suggestion" || node.type === "flow_suggestion";
}

function NodeChildren({ children }: { children: WorkspaceNode[] }) {
  const rendered: ReactNode[] = [];
  for (let index = 0; index < children.length; ) {
    if (!isFlowSuggestion(children[index])) {
      rendered.push(<Node node={children[index]} key={`node-${index}`} />);
      index += 1;
      continue;
    }
    const start = index;
    while (index < children.length && isFlowSuggestion(children[index])) index += 1;
    const suggestions = children.slice(start, index);
    if (suggestions.length === 1) rendered.push(<Node node={suggestions[0]} key={`node-${start}`} />);
    else
      rendered.push(
        <div className="workspace-flow-grid" key={`flow-grid-${start}`}>
          {suggestions.map((suggestion, suggestionIndex) => (
            <Node node={suggestion} key={suggestionIndex} />
          ))}
        </div>,
      );
  }
  return rendered;
}

function Node({ node }: { node: WorkspaceNode }) {
  if (node.type === "stack")
    return (
      <div className={cn("workspace-stack", `gap-${node.gap || "md"}`)}>
        <NodeChildren>{node.children}</NodeChildren>
      </div>
    );
  if (node.type === "grid")
    return (
      <div className={cn("workspace-grid", `cols-${node.columns || 2}`)}>
        {node.children.map((child, index) => (
          <Node node={child} key={index} />
        ))}
      </div>
    );
  if (node.type === "heading")
    return (
      <div className="node-heading">
        {node.level === 3 ? <h3>{node.text}</h3> : <h2>{node.text}</h2>}
        {node.description && <p className="muted">{node.description}</p>}
      </div>
    );
  if (node.type === "metric")
    return (
      <Card className={cn("node-card", node.tone && `tone-${node.tone}`)}>
        <div className="metric-label">{node.label}</div>
        <div className="metric-value">{node.value}</div>
        {node.detail && <div className="muted">{node.detail}</div>}
      </Card>
    );
  if (node.type === "message_group")
    return (
      <Card className="node-card">
        <div className="node-title-row">
          <h3>{node.title}</h3>
          {node.action && <ActionButton action={node.action} />}
        </div>
        <div className="message-list">
          {node.messages.map((message) => (
            <div
              className="message-row"
              key={`${message.account}:${message.folder || "INBOX"}:${message.uid}`}
              onClick={() =>
                runIntent({
                  type: "open_message",
                  account: message.account,
                  uid: message.uid,
                  folder: message.folder,
                })
              }
            >
              <strong>{message.subject || "(no subject)"}</strong>
              <span>
                {message.sender}
                {message.detail ? ` · ${message.detail}` : ""}
              </span>
              {message.tags?.length ? (
                <div className="message-tags">
                  {message.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    );
  if (node.type === "table")
    return (
      <Card className="node-card">
        {node.title && <h3>{node.title}</h3>}
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {node.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  if (node.type === "chart") {
    const maximum = Math.max(...node.data.map((item) => item.value), 1);
    return (
      <Card className="node-card">
        <h3>{node.title}</h3>
        <div className="chart-bars">
          {node.data.map((item) => (
            <div className="chart-row" key={item.label}>
              <span>{item.label}</span>
              <div className="chart-track">
                <div className="chart-fill" style={{ width: `${(item.value / maximum) * 100}%` }} />
              </div>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </Card>
    );
  }
  if (node.type === "sender_cluster")
    return (
      <Card className="node-card">
        <div className="node-title-row">
          <h3>{node.sender}</h3>
          <Badge>{node.count} messages</Badge>
        </div>
        <p className="muted">{node.summary}</p>
        <div className="action-list">
          <Button
            variant="outline"
            size="sm"
            tooltip="Show this sender in Inbox"
            onClick={() => runIntent({ type: "filter_inbox", query: node.sender })}
          >
            View in Inbox
          </Button>
          {node.action && <ActionButton action={node.action} />}
        </div>
      </Card>
    );
  if (node.type === "rule_suggestion" || node.type === "flow_suggestion")
    return (
      <Card className="node-card flow-suggestion-card">
        <Badge tone="good">Suggested flow</Badge>
        <h3 style={{ marginTop: 10 }}>{node.title}</h3>
        <p className="muted">{node.description}</p>
        {node.action && <ActionButton action={node.action} />}
      </Card>
    );
  if (node.type === "search_link")
    return (
      <Card className="node-card search-link-card">
        <div>
          <div className="node-title-row">
            <h3>{node.label}</h3>
            {node.count !== undefined && (
              <Badge className="search-match-count">{node.count.toLocaleString("en-IN")} matches</Badge>
            )}
          </div>
          {node.description && <p className="muted">{node.description}</p>}
          {node.tags?.length ? (
            <div className="message-tags">
              {node.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          ) : null}
        </div>
        <Button
          variant="outline"
          tooltip="Show these matches in Inbox"
          onClick={() => runIntent({ type: "filter_inbox", account: node.account, query: node.query })}
        >
          Search Inbox <ExternalLink size={14} />
        </Button>
      </Card>
    );
  if (node.type === "note")
    return (
      <Card className={cn("node-card", node.tone && `tone-${node.tone}`)}>
        {node.title && <h3>{node.title}</h3>}
        <p className="muted" style={{ marginBottom: 0 }}>
          {node.body}
        </p>
      </Card>
    );
  return (
    <Card className="node-card">
      {node.title && <h3>{node.title}</h3>}
      <div className="action-list">
        {node.actions.map((action, index) => (
          <ActionButton action={action} key={index} />
        ))}
      </div>
    </Card>
  );
}

function GeneratedWorkspaceView({ workspace }: { workspace: GeneratedWorkspace }) {
  return (
    <div className="generated-workspace">
      <header className="generated-header">
        <Badge tone="good">Prepared by Doot</Badge>
        <h1>{workspace.title}</h1>
        <p className="muted">{workspace.summary}</p>
      </header>
      <Node node={workspace.root} />
    </div>
  );
}

export function WorkspaceBoundary({ value }: { value: unknown }) {
  const parsed = generatedWorkspaceSchema.safeParse(value);
  if (!parsed.success)
    return (
      <Card className="node-card">
        <h3>Legacy workspace</h3>
        <p className="muted">
          This saved dashboard predates the current safe component schema. Its original JSON remains in history, but it
          cannot run actions.
        </p>
      </Card>
    );
  return <GeneratedWorkspaceView workspace={parsed.data} />;
}
