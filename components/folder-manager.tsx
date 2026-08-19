"use client";
import { Folder, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { Badge, Button, Card, Dialog, Input, Label } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";
import { isProtectedMailbox } from "@/lib/imap-folder";
import { type MailProvider, mailboxNoun } from "@/lib/mail-provider";

type Account = { name: string; email: string; provider?: MailProvider };
type FolderRow = {
  account: string;
  path: string;
  name: string;
  delimiter: string;
  parent_path: string;
  special_use?: string | null;
  flags: string[];
  subscribed: boolean;
  discovered_at: string;
  protected?: boolean;
  rule_target_allowed?: boolean;
};
type Editor = { mode: "create"; path: string } | { mode: "rename"; path: string; original: string };
type PendingMutation =
  | { kind: "save"; editor: Editor; description: string }
  | { kind: "remove"; folder: FolderRow; description: string };

export function FolderManager({ accounts, initialFolders }: { accounts: Account[]; initialFolders: FolderRow[] }) {
  const toast = useToast();
  const [account, setAccount] = useState(accounts[0]?.name || "");
  const [folders, setFolders] = useState(initialFolders || []);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState("");
  const [detectedProviders, setDetectedProviders] = useState<Record<string, MailProvider>>({});
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);

  useEffect(() => {
    if (!accounts.some((item) => item.name === account)) setAccount(accounts[0]?.name || "");
  }, [accounts, account]);

  const visible = useMemo(() => folders.filter((folder) => folder.account === account), [folders, account]);
  const selectedAccount = accounts.find((item) => item.name === account);
  const provider = detectedProviders[account] || selectedAccount?.provider || "imap";
  const noun = mailboxNoun(provider);
  const replaceAccountFolders = (accountName: string, next: FolderRow[]) =>
    setFolders((old) => [...old.filter((folder) => folder.account !== accountName), ...next]);

  const discover = async () => {
    if (!account) return;
    const accountName = account;
    setLoading(true);
    try {
      const value = await apiJson<{ provider: MailProvider; folders: FolderRow[] }>(
        `/api/accounts/${encodeURIComponent(accountName)}/folders`,
        { cache: "no-store" },
        "Could not discover IMAP folders",
      );
      setDetectedProviders((current) => ({ ...current, [accountName]: value.provider }));
      replaceAccountFolders(accountName, value.folders);
      setNotice("Folder list refreshed");
    } catch (error) {
      toast.error("Could not refresh folders", errorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const save = () => {
    if (!editor || !account || !editor.path.trim()) return;
    const creating = editor.mode === "create";
    const description = creating
      ? `Create ${noun} “${editor.path.trim()}”`
      : `Rename ${noun} “${editor.original}” to “${editor.path.trim()}”`;
    setPendingMutation({
      kind: "save",
      editor: { ...editor },
      description: `${description} on ${selectedAccount?.email}? This changes the upstream ${provider === "gmail" ? "Gmail label" : "IMAP folder"} structure.`,
    });
  };

  const commitSave = async (editorValue: Editor) => {
    const creating = editorValue.mode === "create";
    const accountName = account;
    setLoading(true);
    try {
      const value = await apiJson<{ provider: MailProvider; folders: FolderRow[] }>(
        `/api/accounts/${encodeURIComponent(accountName)}/folders`,
        {
          method: creating ? "POST" : "PUT",
          json: creating
            ? { path: editorValue.path, confirm: true }
            : { path: editorValue.original, new_path: editorValue.path, confirm: true },
        },
        "Could not update the IMAP folder",
      );
      setDetectedProviders((current) => ({ ...current, [accountName]: value.provider }));
      replaceAccountFolders(accountName, value.folders);
      setEditor(null);
      setPendingMutation(null);
      setNotice(creating ? "Folder created" : "Folder renamed");
      toast.success(creating ? `${noun} created` : `${noun} renamed`);
    } catch (error) {
      toast.error(`Could not ${creating ? "create" : "rename"} ${noun}`, errorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (folder: FolderRow) => {
    const warning =
      provider === "gmail"
        ? `Remove Gmail label “${folder.path}” from ${selectedAccount?.email}? Messages keep their other labels and remain in All Mail.`
        : `Delete folder “${folder.path}” from ${selectedAccount?.email}? This upstream change may permanently remove folder contents.`;
    setPendingMutation({ kind: "remove", folder, description: warning });
  };

  const commitRemove = async (folder: FolderRow) => {
    setLoading(true);
    const accountName = account;
    try {
      const value = await apiJson<{ provider: MailProvider; folders: FolderRow[] }>(
        `/api/accounts/${encodeURIComponent(accountName)}/folders`,
        {
          method: "DELETE",
          json: { path: folder.path, confirm: true },
        },
        "Could not delete the IMAP folder",
      );
      setDetectedProviders((current) => ({ ...current, [accountName]: value.provider }));
      replaceAccountFolders(accountName, value.folders);
      setPendingMutation(null);
      setNotice(`${provider === "gmail" ? "Label removed" : "Folder deleted"}; affected flows were paused`);
      toast.success(provider === "gmail" ? "Label removed" : "Folder deleted", "Affected flows were paused.");
    } catch (error) {
      toast.error(
        `Could not ${provider === "gmail" ? "remove the label" : "delete the folder"}`,
        errorMessage(error, "Please try again."),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="settings-section" id="folders">
      <div className="node-title-row">
        <div>
          <h2>
            <Folder size={17} /> {provider === "gmail" ? "Gmail labels" : "IMAP folders"}
          </h2>
          <p className="muted">
            {provider === "gmail"
              ? "Custom labels map to IMAP folders. Removing a label does not delete its messages; Gmail system labels stay protected."
              : "Create and manage upstream folders. System and non-selectable folders stay protected."}
          </p>
        </div>
        <div className="folder-head-actions">
          <Button variant="outline" disabled={!account || loading} onClick={discover}>
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            {loading ? "Working…" : "Refresh"}
          </Button>
          <Button disabled={!account || loading} onClick={() => setEditor({ mode: "create", path: "" })}>
            <Plus size={15} />
            New {noun}
          </Button>
        </div>
      </div>
      {accounts.length ? (
        <>
          <div className="folder-toolbar">
            <select
              aria-label="Folder account"
              value={account}
              onChange={(event) => {
                setAccount(event.target.value);
                setNotice("");
              }}
            >
              {accounts.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.email}
                  {item.provider === "gmail" ? " · Gmail" : ""}
                </option>
              ))}
            </select>
            <span className="muted">
              {notice || (visible.length ? `${visible.length} ${noun}s` : "Not discovered yet")}
            </span>
          </div>
          {visible.length ? (
            <div className="folder-grid">
              {visible.map((folder) => {
                const isProtected = isProtectedMailbox(folder, provider);
                return (
                  <div className="folder-row" key={`${folder.account}:${folder.path}`}>
                    <Folder size={15} />
                    <div>
                      <strong>{folder.path}</strong>
                      <span>
                        {folder.parent_path ? `Under ${folder.parent_path}` : "Top level"}
                        {folder.subscribed ? " · subscribed" : ""}
                      </span>
                    </div>
                    <div className="folder-row-tail">
                      {folder.special_use && <Badge tone="good">{folder.special_use.replace(/^\\/, "")}</Badge>}
                      {isProtected ? (
                        <Badge>Protected</Badge>
                      ) : (
                        <div className="folder-row-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Rename ${noun} ${folder.path}`}
                            disabled={loading}
                            onClick={() => setEditor({ mode: "rename", path: folder.path, original: folder.path })}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`${provider === "gmail" ? "Remove label" : "Delete folder"} ${folder.path}`}
                            disabled={loading}
                            onClick={() => remove(folder)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="memory-empty">
              <Folder size={24} />
              <p>
                No cached {noun}s for {selectedAccount?.email}.
              </p>
              <span className="muted">Refresh to discover the live hierarchy, or create a new {noun} directly.</span>
            </div>
          )}
        </>
      ) : (
        <p className="muted">Connect an account before managing folders.</p>
      )}
      <Dialog
        open={Boolean(editor)}
        title={`${editor?.mode === "rename" ? "Rename" : "Create"} ${noun}`}
        onClose={() => setEditor(null)}
      >
        {editor && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <Label htmlFor="folder-path">Full {noun} path</Label>
            <Input
              id="folder-path"
              autoFocus
              maxLength={512}
              placeholder="Doot/Receipts"
              value={editor.path}
              onChange={(event) => setEditor({ ...editor, path: event.target.value })}
            />
            <span className="field-help">
              {provider === "gmail"
                ? "Use “/” for nested Gmail labels. The reserved [Gmail] and [GoogleMail] hierarchies cannot be changed."
                : "Use the hierarchy separator shown by your provider, usually “/”."}{" "}
              Unicode names are supported.
            </span>
            <div className="memory-dialog-actions" style={{ marginTop: 18 }}>
              <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading || !editor.path.trim()}>
                {editor.mode === "rename" ? `Rename ${noun}` : `Create ${noun}`}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingMutation)}
        title={
          pendingMutation?.kind === "remove"
            ? `${provider === "gmail" ? "Remove label" : "Delete folder"}?`
            : `Confirm ${pendingMutation?.kind === "save" && pendingMutation.editor.mode === "rename" ? "rename" : "creation"}`
        }
        description={<p>{pendingMutation?.description}</p>}
        confirmLabel={
          pendingMutation?.kind === "remove"
            ? provider === "gmail"
              ? "Remove label"
              : "Delete folder"
            : "Confirm change"
        }
        dangerous={pendingMutation?.kind === "remove"}
        busy={loading}
        onConfirm={() => {
          if (pendingMutation?.kind === "save") void commitSave(pendingMutation.editor);
          else if (pendingMutation?.kind === "remove") void commitRemove(pendingMutation.folder);
        }}
        onClose={() => setPendingMutation(null)}
      />
    </Card>
  );
}
