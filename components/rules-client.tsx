"use client";
import {
  Archive,
  Eye,
  Filter,
  FolderInput,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { LocalTime } from "@/components/local-time";
import { ScheduleControls } from "@/components/schedule-controls";
import { Badge, Button, Card, Dialog, Input, Label, Textarea, Tooltip } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";
import { navigateClient, replaceClientUrl } from "@/lib/client-navigation";
import { saveSelectedRule } from "@/lib/client-rule-selection";
import type { MailProvider } from "@/lib/mail-provider";
import type { EmailRule as Rule } from "@/lib/rules";

type Mail = {
  account: string;
  account_email: string;
  uid: string;
  folder: string;
  sender: string;
  subject: string;
  date: string;
};
type Account = { name: string; email: string; provider?: MailProvider };

function FlowStatus({ rule, side = "bottom" }: { rule: Rule; side?: "top" | "bottom" }) {
  const label = rule.enabled ? "Active" : rule.status;
  const help = rule.enabled
    ? "Reviewed; schedules may evaluate it"
    : rule.status === "suggested"
      ? "Waiting for your review"
      : rule.status === "paused"
        ? "Not marked ready for runs"
        : "Saved but not marked active";
  return (
    <Tooltip content={help} side={side}>
      <Badge tone={rule.enabled ? "good" : rule.status === "suggested" ? "attention" : "neutral"}>{label}</Badge>
    </Tooltip>
  );
}

export function RulesClient({
  initialRules,
  accounts,
  folders,
  initialFocus,
}: {
  initialRules: Rule[];
  accounts: Account[];
  folders: any[];
  initialFocus?: number;
}) {
  const toast = useToast();
  const [rules, setRules] = useState(initialRules);
  const [activeId, setActiveId] = useState(
    initialFocus && initialRules.some((rule) => rule.id === initialFocus) ? initialFocus : initialRules[0]?.id,
  );
  const [editor, setEditor] = useState<any>(null);
  const [preview, setPreview] = useState<{ messages: Mail[]; total: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [proposal, setProposal] = useState<any>(null);
  const [applying, setApplying] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const active = rules.find((rule) => rule.id === activeId);
  const accountEmail = (name: string) =>
    name === "all" ? "All accounts" : accounts.find((account) => account.name === name)?.email || name;
  const destinationNoun = (name: string) =>
    accounts.find((account) => account.name === name)?.provider === "gmail" ? "label" : "folder";
  const actionLabel = (rule: Pick<Rule, "action" | "target_folder" | "account">) =>
    rule.action === "archive"
      ? "Archive matching messages"
      : rule.action === "delete"
        ? "Delete matching messages"
        : `Move to ${destinationNoun(rule.account)} ${rule.target_folder}`;
  const editorFolders = useMemo(
    () =>
      folders.filter(
        (folder) =>
          folder.account === editor?.account &&
          folder.rule_target_allowed !== false &&
          !folder.flags?.some((flag: string) => flag.toLowerCase() === "\\noselect"),
      ),
    [folders, editor?.account],
  );

  const replaceRule = (rule: Rule) => {
    setRules((old) => [rule, ...old.filter((item) => item.id !== rule.id)]);
    setActiveId(rule.id);
    replaceClientUrl(`/flows/${rule.id}`);
  };
  const save = async () => {
    if (!editor) return;
    const path = editor.id ? `/api/rules/${editor.id}` : "/api/rules";
    try {
      const value = await apiJson<{ rule: Rule }>(
        path,
        { method: editor.id ? "PUT" : "POST", json: editor },
        "Could not save flow",
      );
      replaceRule(value.rule);
      setEditor(null);
      setPreview(null);
    } catch (error) {
      toast.error("Could not save flow", errorMessage(error, "Please check the flow and try again."));
    }
  };
  const toggle = async (rule: Rule) => {
    try {
      const value = await apiJson<{ rule: Rule }>(
        `/api/rules/${rule.id}`,
        { method: "PUT", json: { enabled: !rule.enabled, status: !rule.enabled ? "active" : "paused" } },
        "Could not update flow",
      );
      replaceRule(value.rule);
      if (rule.enabled) toast.info("Flow paused", "Manual runs remain available.");
      else toast.success("Flow marked active", "It will not run automatically.");
    } catch (error) {
      toast.error("Could not update flow", errorMessage(error, "Please try again."));
    }
  };
  const remove = (rule: Rule) => setPendingDelete(rule);
  const confirmRemove = async () => {
    if (!pendingDelete) return;
    const rule = pendingDelete;
    setDeleting(true);
    try {
      await apiJson(`/api/rules/${rule.id}`, { method: "DELETE", json: { confirm: true } }, "Could not delete flow");
      const remaining = rules.filter((item) => item.id !== rule.id);
      setRules(remaining);
      setActiveId(remaining[0]?.id);
      setPreview(null);
      replaceClientUrl(remaining[0] ? `/flows/${remaining[0].id}` : "/flows");
      setPendingDelete(null);
      toast.success("Flow deleted", "No email was changed.");
    } catch (error) {
      toast.error("Could not delete flow", errorMessage(error, "Please try again."));
    } finally {
      setDeleting(false);
    }
  };
  const loadPreview = async (rule: Rule) => {
    setPreviewing(true);
    try {
      setPreview(
        await apiJson(`/api/rules/${rule.id}/preview?limit=25`, { cache: "no-store" }, "Could not preview flow"),
      );
    } catch (error) {
      toast.error("Could not preview flow", errorMessage(error, "Please try again."));
    } finally {
      setPreviewing(false);
    }
  };
  const reviewRun = (rule: Rule) => {
    if (!preview?.total) return;
    setProposal({
      rule,
      matched: preview.total,
      proposed: Math.min(preview.total, 100),
      messages: preview.messages.slice(0, 8),
    });
  };
  const apply = async () => {
    if (!proposal || applying) return;
    setApplying(true);
    try {
      const result = await apiJson<any>(
        `/api/rules/${proposal.rule.id}/run`,
        { method: "POST", json: { confirm: true } },
        "Could not run flow",
      );
      setProposal(null);
      if (active) await loadPreview(active);
      if (result.applied?.status === "applied") toast.success("Flow applied", `${result.proposed} message(s) updated.`);
      else toast.info("Flow finished", `Status: ${result.applied?.status || "unknown"}`);
    } catch (error) {
      toast.error("Could not run flow", errorMessage(error, "Please try again."));
    } finally {
      setApplying(false);
    }
  };
  useEffect(() => {
    const focused = rules.find((rule) => rule.id === activeId);
    if (focused) void loadPreview(focused);
  }, [activeId]);
  const openEditor = (rule?: Rule) =>
    setEditor(
      rule
        ? { ...rule }
        : {
            name: "",
            account: "all",
            query: "",
            action: "archive",
            target_folder: "",
            status: "draft",
            enabled: false,
            rationale: "",
          },
    );
  const askAgent = (rule: Rule) => {
    saveSelectedRule({ id: rule.id, name: rule.name });
    navigateClient("/");
  };
  const inboxUrl = (rule: Rule) => {
    const params = new URLSearchParams();
    if (rule.account !== "all") params.set("account", rule.account);
    params.set("query", rule.query);
    return `/inbox?${params}`;
  };

  return (
    <main className="page rules-page">
      <header className="page-head">
        <h1>Flows</h1>
        <Button tooltip="Create a reusable filter" onClick={() => openEditor()}>
          <Plus size={15} />
          New flow
        </Button>
      </header>
      <div className="rules-layout">
        <aside className="rules-sidebar">
          <div className="rules-summary">
            <Tooltip content="Reviewed; schedules may evaluate it">
              <Badge tone="good">{rules.filter((rule) => rule.enabled).length} active</Badge>
            </Tooltip>
            <Tooltip content="Waiting for your review">
              <Badge>{rules.filter((rule) => rule.status === "suggested").length} suggested</Badge>
            </Tooltip>
          </div>
          {rules.length ? (
            rules.map((rule) => (
              <Link
                href={`/flows/${rule.id}`}
                className={`rule-list-item ${activeId === rule.id ? "active" : ""}`}
                key={rule.id}
                onClick={(event) => {
                  event.preventDefault();
                  setActiveId(rule.id);
                  replaceClientUrl(`/flows/${rule.id}`);
                }}
              >
                <span className="rule-list-icon">
                  {rule.action === "archive" ? (
                    <Archive size={15} />
                  ) : rule.action === "delete" ? (
                    <Trash2 size={15} />
                  ) : (
                    <FolderInput size={15} />
                  )}
                </span>
                <span>
                  <strong>{rule.name}</strong>
                  <small>
                    {accountEmail(rule.account)} · {rule.action}
                    {rule.target_folder ? ` to ${rule.target_folder}` : ""}
                  </small>
                </span>
                <FlowStatus rule={rule} side="top" />
              </Link>
            ))
          ) : (
            <div className="rules-empty">
              <Filter size={25} />
              <p>No flows yet.</p>
              <span>Build one manually or ask Doot to suggest reusable patterns.</span>
            </div>
          )}
        </aside>
        <section className="rules-detail">
          {active ? (
            <>
              <Card className="rule-hero">
                <div className="node-title-row">
                  <div>
                    <div className="rule-badges">
                      <FlowStatus rule={active} />
                      {active.source === "agent" && (
                        <Badge>
                          <Sparkles size={11} />
                          Doot suggested
                        </Badge>
                      )}
                      {active.account !== "all" &&
                        accounts.find((account) => account.name === active.account)?.provider === "gmail" && (
                          <Badge>Gmail labels</Badge>
                        )}
                    </div>
                    <h2>{active.name}</h2>
                    <p className="muted">{active.rationale || "No rationale provided."}</p>
                  </div>
                  <div className="action-list">
                    <Button variant="outline" tooltip="Open this Flow in chat" onClick={() => askAgent(active)}>
                      <MessageSquare size={14} />
                      Ask Doot to modify
                    </Button>
                    <Button variant="outline" tooltip="Change filter or action" onClick={() => openEditor(active)}>
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      tooltip={active.enabled ? "Pause attached schedule evaluations" : "Mark reviewed and schedulable"}
                      onClick={() => toggle(active)}
                    >
                      {active.enabled ? <Pause size={14} /> : <Play size={14} />}
                      {active.enabled ? "Pause flow" : "Mark active"}
                    </Button>
                    <Button variant="danger" tooltip="Remove Flow; keep email" onClick={() => remove(active)}>
                      <Trash2 size={14} />
                      Delete flow
                    </Button>
                  </div>
                </div>
                <div className="rule-definition">
                  <div>
                    <span>Account</span>
                    <strong>{accountEmail(active.account)}</strong>
                  </div>
                  <div>
                    <span>Filter</span>
                    <code>{active.query}</code>
                  </div>
                  <div>
                    <span>Action</span>
                    <strong>{actionLabel(active)}</strong>
                  </div>
                  <div>
                    <span>Updated</span>
                    <LocalTime value={active.updated_at} />
                  </div>
                </div>
              </Card>
              <Card className="rule-preview">
                <div className="node-title-row">
                  <div>
                    <h2>Current matches</h2>
                    <p className="muted">
                      Review the exact filter results before approving a one-time run. Nothing changes during preview.
                    </p>
                  </div>
                  <div className="action-list">
                    <Button
                      variant="outline"
                      tooltip="Recheck current cached matches"
                      onClick={() => loadPreview(active)}
                      disabled={previewing}
                    >
                      <Eye size={14} />
                      {previewing ? "Checking…" : "Refresh preview"}
                    </Button>
                    <a
                      className="button button-outline button-sm"
                      href={inboxUrl(active)}
                      data-tooltip="Show matches in Inbox"
                      data-tooltip-side="bottom"
                    >
                      <Search size={14} />
                      Open filter
                    </a>
                    <Button
                      tooltip="Review approval before mailbox changes"
                      onClick={() => reviewRun(active)}
                      disabled={!preview?.total}
                    >
                      <Play size={14} />
                      Review &amp; run
                    </Button>
                  </div>
                </div>
                {preview ? (
                  <>
                    <div className="rule-match-count">
                      <strong>{preview.total}</strong>
                      <span>cached matches · up to 100 per approved run</span>
                    </div>
                    {preview.messages.length ? (
                      <div className="rule-message-list">
                        {preview.messages.map((mail) => (
                          <a
                            key={`${mail.account}:${mail.folder}:${mail.uid}`}
                            href={`/inbox?account=${encodeURIComponent(mail.account)}&open=${mail.uid}&folder=${encodeURIComponent(mail.folder)}`}
                          >
                            <div>
                              <strong>{mail.subject || "(no subject)"}</strong>
                              <span>{mail.sender}</span>
                            </div>
                            <LocalTime value={mail.date} />
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">No current matches.</p>
                    )}
                  </>
                ) : (
                  <div className="rules-empty">
                    <Eye size={24} />
                    <p>Loading a safe preview…</p>
                  </div>
                )}
              </Card>
              <ScheduleControls kind="flow" ruleId={active.id} />
            </>
          ) : (
            <div className="rules-empty">
              <Filter size={28} />
              <p>Select or create a flow.</p>
            </div>
          )}
        </section>
      </div>
      <Dialog open={Boolean(editor)} title={editor?.id ? "Edit flow" : "Create flow"} onClose={() => setEditor(null)}>
        {editor && (
          <div className="form-grid">
            <div className="field-wide">
              <Label>Name</Label>
              <Input
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                placeholder="Archive deployment successes"
              />
            </div>
            <div>
              <Label>Account</Label>
              <select
                value={editor.account}
                onChange={(event) => setEditor({ ...editor, account: event.target.value, target_folder: "" })}
              >
                <option value="all">All accounts</option>
                {accounts.map((account) => (
                  <option key={account.name} value={account.name}>
                    {account.email}
                    {account.provider === "gmail" ? " · Gmail" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Action</Label>
              <select
                value={editor.action}
                onChange={(event) => setEditor({ ...editor, action: event.target.value, target_folder: "" })}
              >
                <option value="archive">Archive</option>
                <option value="move">Move to {destinationNoun(editor.account)}</option>
                <option value="delete">Delete</option>
              </select>
            </div>
            <div className="field-wide">
              <Label>Filter query</Label>
              <Input
                value={editor.query}
                onChange={(event) => setEditor({ ...editor, query: event.target.value })}
                placeholder={'from:notifications@github.com "Run succeeded"'}
              />
              <span className="field-help">Supports plain terms plus from:, sender:, subject:, and domain:.</span>
            </div>
            {editor.action === "move" && (
              <div className="field-wide">
                <Label>Destination {destinationNoun(editor.account)}</Label>
                <select
                  value={editor.target_folder || ""}
                  onChange={(event) => setEditor({ ...editor, target_folder: event.target.value })}
                >
                  <option value="">Select a discovered {destinationNoun(editor.account)}</option>
                  {editorFolders.map((folder) => (
                    <option key={folder.path} value={folder.path}>
                      {folder.path}
                    </option>
                  ))}
                </select>
                {editor.account === "all" && <span className="field-help">Move flows must target one account.</span>}
                {accounts.find((account) => account.name === editor.account)?.provider === "gmail" && (
                  <span className="field-help">
                    Gmail applies the destination label and removes Inbox when this move is confirmed.
                  </span>
                )}
              </div>
            )}
            {editor.action === "delete" && (
              <div className="field-wide">
                <span className="field-help">
                  Delete flows remain manual. Every run shows the current matches and requires explicit approval before
                  mailbox changes.
                </span>
              </div>
            )}
            <div className="field-wide">
              <Label>Rationale</Label>
              <Textarea
                value={editor.rationale || ""}
                onChange={(event) => setEditor({ ...editor, rationale: event.target.value })}
                placeholder="Why this pattern is safe and useful"
              />
            </div>
            <div className="field-wide memory-dialog-actions">
              <Button variant="outline" tooltip="Discard unsaved Flow changes" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button tooltip="Store without running it" onClick={save}>
                Save flow
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <Dialog
        open={Boolean(proposal)}
        title="Approve and run flow"
        closeDisabled={applying}
        onClose={() => !applying && setProposal(null)}
      >
        <div className="rule-definition rule-approval-definition">
          <div className="rule-approval-filter">
            <span>Filter</span>
            <code>{proposal?.rule?.query}</code>
          </div>
          <div className="rule-approval-account">
            <span>Account</span>
            <strong>{proposal?.rule ? accountEmail(proposal.rule.account) : ""}</strong>
          </div>
          <div>
            <span>Action</span>
            <strong>{proposal?.rule ? actionLabel(proposal.rule) : ""}</strong>
          </div>
          <div>
            <span>This run</span>
            <strong>
              {proposal?.proposed} of {proposal?.matched} matches
            </strong>
          </div>
        </div>
        <p className="muted">
          Approval creates an audited proposal and immediately applies this one run. The saved flow itself never runs
          automatically.
        </p>
        {proposal?.rule?.action === "delete" && (
          <p className="rule-delete-warning">
            <Trash2 size={15} />
            This run will delete the reviewed matching messages from the upstream mailbox.
          </p>
        )}
        {proposal?.messages?.length ? (
          <div className="rule-message-list">
            {proposal.messages.map((mail: Mail) => (
              <div key={`${mail.account}:${mail.folder}:${mail.uid}`}>
                <div>
                  <strong>{mail.subject || "(no subject)"}</strong>
                  <span>{mail.sender}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {applying && <p className="mailbox-apply-status">Updating the mailbox. Keep this dialog open…</p>}
        <div className="memory-dialog-actions" aria-busy={applying}>
          <Button
            variant="outline"
            tooltip={applying ? undefined : "Return without changing email"}
            tooltipSide="top"
            disabled={applying}
            onClick={() => setProposal(null)}
          >
            Cancel
          </Button>
          <Button
            variant={proposal?.rule?.action === "delete" ? "danger" : "default"}
            tooltip={applying ? undefined : "Apply this reviewed batch"}
            tooltipSide="top"
            disabled={applying}
            onClick={apply}
          >
            {applying ? "Applying…" : "Approve and run"}
          </Button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete flow?"
        description={
          <>
            <p>
              Delete <strong>{pendingDelete?.name}</strong> from this app?
            </p>
            <p className="muted">This removes only the saved flow. No email will be changed.</p>
          </>
        }
        confirmLabel="Delete flow"
        dangerous
        busy={deleting}
        onConfirm={() => void confirmRemove()}
        onClose={() => setPendingDelete(null)}
      />
    </main>
  );
}
