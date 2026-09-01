"use client";

import { Bot, FilePlus2, Save, SendToBack, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { Badge, Button, Card, Input, Label, Textarea } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";
import { saveSelectedDraft } from "@/lib/client-draft-selection";
import { navigateClient, replaceClientUrl } from "@/lib/client-navigation";

type Draft = {
  id: number;
  title: string;
  status: "draft" | "saved";
  created_at: string;
  content: {
    account: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    body: string;
    in_reply_to?: string;
    references: string[];
    context_messages: Array<{ account: string; uid: string; folder?: string }>;
  };
};

const splitAddresses = (value: string) =>
  value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);

export function DraftsClient({
  initialDrafts,
  accounts,
  initialFocus,
}: {
  initialDrafts: Draft[];
  accounts: Array<{ name: string; email: string }>;
  initialFocus?: number;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState(initialDrafts);
  const [activeId, setActiveId] = useState(initialFocus || initialDrafts[0]?.id || 0);
  const [editor, setEditor] = useState<Draft["content"] | null>(
    initialDrafts.find((draft) => draft.id === (initialFocus || initialDrafts[0]?.id))?.content || null,
  );
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"imap" | "delete" | null>(null);
  const active = useMemo(() => drafts.find((draft) => draft.id === activeId), [drafts, activeId]);

  const select = (draft: Draft) => {
    setActiveId(draft.id);
    setEditor(structuredClone(draft.content));
    replaceClientUrl(`/drafts/${draft.id}`);
  };
  const refresh = async (focus?: number) => {
    const value = await apiJson<{ drafts: Draft[] }>("/api/drafts");
    setDrafts(value.drafts);
    if (focus) {
      const selected = value.drafts.find((draft) => draft.id === focus);
      if (selected) select(selected);
    }
  };
  const create = async (withDoot = false) => {
    if (!accounts[0]) return toast.error("Connect an account first", "Drafts need an IMAP account.");
    setBusy(true);
    try {
      const value = await apiJson<{ draft: Draft }>("/api/drafts", {
        method: "POST",
        json: {
          account: accounts[0].name,
          to: [],
          cc: [],
          bcc: [],
          subject: "",
          body: "",
          references: [],
          context_messages: [],
        },
      });
      setDrafts((current) => [value.draft, ...current]);
      select(value.draft);
      toast.success("Local draft created");
      if (withDoot) {
        saveSelectedDraft({ id: value.draft.id, title: value.draft.title });
        navigateClient("/");
      }
    } catch (error) {
      toast.error("Could not create draft", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const saveLocal = async () => {
    if (!active || !editor) return null;
    setBusy(true);
    try {
      const value = await apiJson<{ draft: Draft }>(`/api/drafts/${active.id}`, {
        method: "PUT",
        json: editor,
      });
      setDrafts((current) => current.map((item) => (item.id === value.draft.id ? value.draft : item)));
      setEditor(value.draft.content);
      toast.success("Draft saved locally");
      return value.draft;
    } catch (error) {
      toast.error("Could not save draft", errorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const askDoot = async () => {
    const draft = await saveLocal();
    if (!draft) return;
    saveSelectedDraft({ id: draft.id, title: draft.title });
    navigateClient("/");
  };
  const confirmImap = async () => {
    if (!active || !editor) return;
    setBusy(true);
    try {
      await apiJson(`/api/drafts/${active.id}`, { method: "PUT", json: editor });
      await apiJson(`/api/drafts/${active.id}/save`, { method: "POST", json: { confirm: true } });
      await refresh(active.id);
      setConfirmation(null);
      toast.success("Saved to IMAP Drafts", "The message was saved as a draft; it was not sent.");
    } catch (error) {
      toast.error("Could not save to IMAP", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await apiJson(`/api/drafts/${active.id}`, { method: "DELETE", json: { confirm: true } });
      const remaining = drafts.filter((draft) => draft.id !== active.id);
      setDrafts(remaining);
      setActiveId(remaining[0]?.id || 0);
      setEditor(remaining[0]?.content || null);
      replaceClientUrl("/drafts");
      setConfirmation(null);
      toast.success("Local draft removed", active.status === "saved" ? "Its IMAP copy was retained." : undefined);
    } catch (error) {
      toast.error("Could not remove draft", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page drafts-page">
      <header className="page-head">
        <h1>Drafts</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="outline"
            tooltip="Start a draft in chat"
            onClick={() => void create(true)}
            disabled={busy || !accounts.length}
          >
            <Bot size={16} /> Draft with Doot
          </Button>
          <Button
            tooltip="Create an empty local draft"
            onClick={() => void create()}
            disabled={busy || !accounts.length}
          >
            <FilePlus2 size={16} /> New draft
          </Button>
        </div>
      </header>
      <div className={`drafts-layout ${drafts.length ? "" : "drafts-layout-empty"}`}>
        <Card className="draft-list">
          {drafts.length ? (
            drafts.map((draft) => (
              <button
                type="button"
                key={draft.id}
                className={`draft-list-item ${draft.id === activeId ? "active" : ""}`}
                onClick={() => select(draft)}
              >
                <span>
                  <strong>{draft.title}</strong>
                  <small>{draft.content.to.join(", ") || "No recipient yet"}</small>
                </span>
                <Badge tone={draft.status === "saved" ? "good" : "neutral"}>
                  {draft.status === "saved" ? "In IMAP" : "Local"}
                </Badge>
              </button>
            ))
          ) : (
            <div className="draft-empty">
              <FilePlus2 size={25} />
              <strong>No drafts yet</strong>
              <span>Choose New draft or Draft with Doot.</span>
            </div>
          )}
        </Card>
        <Card className="draft-editor">
          {active && editor ? (
            <>
              <div className="node-title-row">
                <div>
                  <h2>{editor.subject || "Untitled draft"}</h2>
                  <p className="muted">
                    {active.status === "saved"
                      ? "Saved to IMAP; editing creates a new local revision."
                      : "Local only — nothing has been sent or uploaded."}
                  </p>
                </div>
                <Badge tone={active.status === "saved" ? "good" : "attention"}>
                  {active.status === "saved" ? "Saved in IMAP" : "Local draft"}
                </Badge>
              </div>
              <div className="draft-fields">
                <div>
                  <Label>From account</Label>
                  <select
                    value={editor.account}
                    onChange={(event) => setEditor({ ...editor, account: event.target.value })}
                  >
                    {accounts.map((account) => (
                      <option key={account.name} value={account.name}>
                        {account.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>To</Label>
                  <Input
                    value={editor.to.join(", ")}
                    placeholder="name@example.com"
                    onChange={(event) => setEditor({ ...editor, to: splitAddresses(event.target.value) })}
                  />
                </div>
                <div>
                  <Label>Cc</Label>
                  <Input
                    value={editor.cc.join(", ")}
                    onChange={(event) => setEditor({ ...editor, cc: splitAddresses(event.target.value) })}
                  />
                </div>
                <div>
                  <Label>Bcc</Label>
                  <Input
                    value={editor.bcc.join(", ")}
                    onChange={(event) => setEditor({ ...editor, bcc: splitAddresses(event.target.value) })}
                  />
                </div>
                <div className="field-wide">
                  <Label>Subject</Label>
                  <Input
                    value={editor.subject}
                    onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
                  />
                </div>
                <div className="field-wide">
                  <Label>Message</Label>
                  <Textarea
                    className="draft-body"
                    value={editor.body}
                    onChange={(event) => setEditor({ ...editor, body: event.target.value })}
                  />
                </div>
              </div>
              <div className="draft-actions">
                <Button
                  variant="danger"
                  tooltip="Remove only the local copy"
                  tooltipSide="top"
                  onClick={() => setConfirmation("delete")}
                  disabled={busy}
                >
                  <Trash2 size={15} /> Remove local
                </Button>
                <span />
                <Button
                  variant="outline"
                  tooltip="Open draft context in chat"
                  tooltipSide="top"
                  onClick={() => void askDoot()}
                  disabled={busy}
                >
                  <Bot size={15} /> Ask Doot to revise
                </Button>
                <Button
                  variant="outline"
                  tooltip="Store changes only in SQLite"
                  tooltipSide="top"
                  onClick={() => void saveLocal()}
                  disabled={busy}
                >
                  <Save size={15} /> Save locally
                </Button>
                <Button
                  tooltip="Append without sending the message"
                  tooltipSide="top"
                  onClick={() => setConfirmation("imap")}
                  disabled={busy}
                >
                  <SendToBack size={15} /> Save to IMAP Drafts
                </Button>
              </div>
            </>
          ) : (
            <div className="draft-empty">
              <Bot size={28} />
              <strong>No draft selected</strong>
              <span>Create a blank draft or start one in chat with Draft with Doot.</span>
            </div>
          )}
        </Card>
      </div>
      <ConfirmDialog
        open={confirmation === "imap"}
        title="Save this draft to IMAP?"
        description={
          <>
            <p>This appends the message to the account’s advertised Drafts folder.</p>
            <p className="muted">It will not send the email. You can continue editing it in your mail client.</p>
          </>
        }
        confirmLabel="Save to Drafts"
        busy={busy}
        onConfirm={() => void confirmImap()}
        onClose={() => setConfirmation(null)}
      />
      <ConfirmDialog
        open={confirmation === "delete"}
        title="Remove this local draft?"
        description={
          <p>
            {active?.status === "saved"
              ? "The local copy will be removed. The copy already saved in IMAP will remain."
              : "This local draft will be permanently removed."}
          </p>
        }
        confirmLabel="Remove local draft"
        dangerous
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onClose={() => setConfirmation(null)}
      />
    </main>
  );
}
