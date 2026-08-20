"use client";
import { MailPlus, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { FolderManager } from "@/components/folder-manager";
import { MemoryManager } from "@/components/memory-manager";
import { ProviderAuthManager } from "@/components/provider-auth-manager";
import { ScheduleControls } from "@/components/schedule-controls";
import { Badge, Button, Card, Dialog, Input, Label } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

export function SettingsClient({ initial }: { initial: any }) {
  const toast = useToast();
  const [accounts, setAccounts] = useState(initial.accounts);
  const [settings, setSettings] = useState(initial.settings);
  const [models, setModels] = useState(initial.models);
  const [editor, setEditor] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [pendingAccountRemoval, setPendingAccountRemoval] = useState<string | null>(null);
  const [removingAccount, setRemovingAccount] = useState(false);
  const refreshAccounts = async () => setAccounts((await apiJson<{ accounts: any[] }>("/api/accounts")).accounts);
  const saveAccount = async () => {
    const path = editor.name ? `/api/accounts/${encodeURIComponent(editor.name)}` : "/api/accounts";
    try {
      await apiJson(path, { method: editor.name ? "PUT" : "POST", json: editor }, "Could not save account");
      setEditor(null);
      await refreshAccounts();
      toast.success("Account saved");
    } catch (error) {
      toast.error("Could not save account", errorMessage(error, "Please check the connection details."));
    }
  };
  const remove = (name: string) => setPendingAccountRemoval(name);
  const confirmRemove = async () => {
    if (!pendingAccountRemoval) return;
    const name = pendingAccountRemoval;
    setRemovingAccount(true);
    try {
      await apiJson(
        `/api/accounts/${encodeURIComponent(name)}`,
        { method: "DELETE", json: { confirm: true } },
        "Could not remove account",
      );
      await refreshAccounts();
      setPendingAccountRemoval(null);
      toast.success("Connection removed", "Cached email was retained.");
    } catch (error) {
      toast.error("Could not remove account", errorMessage(error, "Please try again."));
    } finally {
      setRemovingAccount(false);
    }
  };
  const test = async (name: string) => {
    try {
      await apiJson(`/api/accounts/${encodeURIComponent(name)}/test`, { method: "POST" }, "Connection failed");
      toast.success("Connection succeeded");
    } catch (error) {
      toast.error("Connection failed", errorMessage(error, "Check the credentials and IMAP settings."));
    }
  };
  const saveSettings = async () => {
    try {
      const value = await apiJson<{ settings: any }>(
        "/api/settings",
        { method: "PUT", json: settings },
        "Could not save settings",
      );
      setSettings(value.settings);
      setNotice("Settings saved");
      setTimeout(() => setNotice(""), 1800);
      toast.success("Settings saved");
    } catch (error) {
      toast.error("Could not save settings", errorMessage(error, "Please try again."));
    }
  };
  const chooseModel = (value: string) => {
    const model = models.find((item: any) => `${item.provider}:${item.id}` === value);
    setSettings({
      ...settings,
      agent_provider: model?.provider || "",
      agent_model: model?.id || "",
    });
  };
  return (
    <main className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <Button tooltip="Persist every settings section" onClick={saveSettings}>
          <Save size={15} />
          {notice || "Save settings"}
        </Button>
      </header>
      <div className="settings-grid">
        <aside>
          <Card style={{ padding: 9 }}>
            <a className="session-link" href="#accounts">
              Accounts
            </a>
            <a className="session-link" href="#provider">
              Provider
            </a>
            <a className="session-link" href="#agent">
              Doot
            </a>
            <a className="session-link" href="#folders">
              Folders
            </a>
            <a className="session-link" href="#memory">
              Memory
            </a>
            <a className="session-link" href="#sync">
              Sync
            </a>
            <a className="session-link" href="#privacy">
              Privacy
            </a>
            <a className="session-link" href="#artifacts">
              Artifacts
            </a>
          </Card>
        </aside>
        <div className="settings-main">
          <Card className="settings-section" id="accounts">
            <div className="node-title-row">
              <div>
                <h2>Connected accounts</h2>
                <p className="muted">Passwords are write-only and never returned by the API.</p>
              </div>
              <Button
                variant="outline"
                tooltip="Connect another IMAP account"
                tooltipAlign="right"
                onClick={() =>
                  setEditor({
                    username: "",
                    host: "imap.gmail.com",
                    port: 993,
                    password: "",
                    use_ssl: true,
                  })
                }
              >
                <MailPlus size={15} />
                Add
              </Button>
            </div>
            {accounts.map((account: any) => (
              <div className="account-row" key={account.name}>
                <div>
                  <strong>{account.email}</strong>
                  <div className="muted">
                    {account.host}:{account.port} · {account.use_ssl ? "TLS" : "Plain"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 7 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    tooltip="Test IMAP credentials now"
                    onClick={() => test(account.name)}
                  >
                    Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    tooltip="Change this account connection"
                    onClick={() =>
                      setEditor({
                        ...account,
                        username: account.email,
                        password: "",
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    tooltip="Disconnect but retain cached mail"
                    tooltipAlign="right"
                    onClick={() => remove(account.name)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </Card>
          <FolderManager accounts={accounts} initialFolders={initial.folders || []} />
          <ProviderAuthManager initialProviders={initial.providers || []} onModels={setModels} />
          <Card className="settings-section" id="agent">
            <h2>Doot model</h2>
            <div className="form-grid">
              <div>
                <Label>Model</Label>
                <select
                  value={
                    settings.agent_provider && settings.agent_model
                      ? `${settings.agent_provider}:${settings.agent_model}`
                      : ""
                  }
                  onChange={(event) => chooseModel(event.target.value)}
                >
                  <option value="">{models.length ? "Automatic default" : "Connect a provider first"}</option>
                  {models.map((model: any) => (
                    <option key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
                      {model.provider} · {model.name}
                      {model.reasoning ? " · reasoning" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Reasoning effort</Label>
                <select
                  value={settings.agent_thinking}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      agent_thinking: event.target.value,
                    })
                  }
                >
                  {["off", "minimal", "low", "medium", "high", "xhigh"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>
          <MemoryManager initialNamespaces={initial.memoryNamespaces || []} />
          <Card className="settings-section" id="sync">
            <h2>Sync behavior</h2>
            <div className="form-grid">
              <div>
                <Label>Lookback days</Label>
                <Input
                  type="number"
                  value={settings.sync_days}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      sync_days: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div>
                <Label>Cached Inbox target</Label>
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={settings.initial_sync_limit}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      initial_sync_limit: Number(event.target.value),
                    })
                  }
                />
                <div className="muted">
                  Sync fills missing recent messages up to this target while retaining already cached bodies.
                </div>
              </div>
            </div>
            <div className="switch-row">
              <div>
                <strong>Sync on application start</strong>
                <div className="muted">The UI never runs Doot automatically after sync.</div>
              </div>
              <input
                type="checkbox"
                checked={settings.sync_on_start}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    sync_on_start: event.target.checked,
                    auto_organize: false,
                  })
                }
              />
            </div>
          </Card>
          <ScheduleControls kind="sync" />
          <Card className="settings-section" id="privacy">
            <h2>Privacy and delegation</h2>
            <div className="switch-row">
              <div>
                <strong>Load remote images</strong>
                <div className="muted">Off by default to prevent tracking pixels.</div>
              </div>
              <input
                type="checkbox"
                checked={settings.allow_remote_images}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    allow_remote_images: event.target.checked,
                  })
                }
              />
            </div>
            <div className="switch-row">
              <div>
                <strong>Allow selected message content in Doot</strong>
                <div className="muted">Headers remain available; bodies require explicit selection.</div>
              </div>
              <input
                type="checkbox"
                checked={settings.share_message_content}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    share_message_content: event.target.checked,
                  })
                }
              />
            </div>
            <div className="switch-row">
              <div>
                <strong>Enable delegated analysis</strong>
                <div className="muted">Requires separate permission for each selection.</div>
              </div>
              <input
                type="checkbox"
                checked={settings.agent_delegation}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    agent_delegation: event.target.checked,
                  })
                }
              />
            </div>
            <p className="muted">
              <ShieldCheck size={15} style={{ display: "inline" }} /> Mailbox writes always stop at browser
              confirmation.
            </p>
          </Card>
          <Card className="settings-section" id="artifacts">
            <h2>Local artifacts</h2>
            {initial.artifacts.length ? (
              initial.artifacts.map((item: any) => (
                <div className="account-row" id={`artifact-${item.id}`} key={item.id}>
                  <div>
                    <Badge>{item.kind}</Badge> <strong>{item.title}</strong>
                    <div className="muted">
                      {typeof item.content === "string" ? item.content : JSON.stringify(item.content)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">No drafts, flows, or notes yet.</p>
            )}
          </Card>
        </div>
      </div>
      <Dialog
        open={Boolean(editor)}
        title={editor?.name ? "Edit account" : "Connect account"}
        onClose={() => setEditor(null)}
      >
        {editor && (
          <div className="form-grid">
            <div className="field-wide">
              <Label>Email address</Label>
              <Input
                value={editor.username}
                onChange={(event) => setEditor({ ...editor, username: event.target.value })}
              />
            </div>
            <div>
              <Label>IMAP host</Label>
              <Input value={editor.host} onChange={(event) => setEditor({ ...editor, host: event.target.value })} />
            </div>
            <div>
              <Label>Port</Label>
              <Input
                type="number"
                value={editor.port}
                onChange={(event) => setEditor({ ...editor, port: Number(event.target.value) })}
              />
            </div>
            <div className="field-wide">
              <Label>{editor.name ? "New password (leave blank to keep)" : "Password or app password"}</Label>
              <Input
                type="password"
                value={editor.password}
                onChange={(event) => setEditor({ ...editor, password: event.target.value })}
              />
            </div>
            <label className="switch-row field-wide">
              <span>Use TLS</span>
              <input
                type="checkbox"
                checked={editor.use_ssl}
                onChange={(event) => setEditor({ ...editor, use_ssl: event.target.checked })}
              />
            </label>
            <div className="field-wide" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="outline" tooltip="Discard account connection changes" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button tooltip="Store this IMAP connection" onClick={saveAccount}>
                Save account
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingAccountRemoval)}
        title="Remove connection?"
        description={
          <>
            <p>Disconnect this email account?</p>
            <p className="muted">Cached email will be retained locally.</p>
          </>
        }
        confirmLabel="Remove connection"
        dangerous
        busy={removingAccount}
        onConfirm={() => void confirmRemove()}
        onClose={() => setPendingAccountRemoval(null)}
      />
    </main>
  );
}
