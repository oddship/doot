"use client";
import { Brain, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog, useToast } from "@/components/feedback";
import { LocalTime } from "@/components/local-time";
import { Badge, Button, Card, Dialog, Input, Label, Textarea } from "@/components/ui";
import { apiJson, errorMessage } from "@/lib/client-api";

type Namespace = { namespace: string; count: number; updated_at: string };
type MemoryItem = {
  namespace: string;
  key: string;
  value: unknown;
  created_at: string;
  updated_at: string;
};

export function MemoryManager({ initialNamespaces }: { initialNamespaces: Namespace[] }) {
  const toast = useToast();
  const [namespaces, setNamespaces] = useState(initialNamespaces);
  const [namespace, setNamespace] = useState(initialNamespaces[0]?.namespace || "");
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState<{
    originalKey?: string;
    namespace: string;
    key: string;
    value: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MemoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshNamespaces = async () => {
    const value = await apiJson<{ namespaces: Namespace[] }>(
      "/api/agent/memory",
      { cache: "no-store" },
      "Could not refresh Doot memory",
    );
    setNamespaces(value.namespaces || []);
  };
  const load = async (target = namespace, targetPrefix = prefix) => {
    if (!target) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const value = await apiJson<{ items: MemoryItem[] }>(
        `/api/agent/memory?namespace=${encodeURIComponent(target)}&prefix=${encodeURIComponent(targetPrefix)}`,
        { cache: "no-store" },
        "Could not load Doot memory",
      );
      setItems(value.items || []);
    } catch (error) {
      toast.error("Could not load Doot memory", errorMessage(error, "Please try again."));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load(namespace, "");
  }, []);

  const save = async () => {
    if (!editor) return;
    let value: unknown;
    try {
      value = JSON.parse(editor.value);
    } catch {
      toast.error("Invalid JSON", "Memory values must contain valid JSON.");
      return;
    }
    try {
      await apiJson(
        "/api/agent/memory",
        { method: "PUT", json: { namespace: editor.namespace, key: editor.key, value } },
        "Could not save memory",
      );
      if (editor.originalKey && editor.originalKey !== editor.key) {
        await apiJson(
          "/api/agent/memory",
          { method: "DELETE", json: { namespace: editor.namespace, key: editor.originalKey, confirm: true } },
          "Could not remove the old memory key",
        );
      }
      setNamespace(editor.namespace);
      setPrefix("");
      setEditor(null);
      await refreshNamespaces();
      await load(editor.namespace, "");
      toast.success("Memory saved");
    } catch (error) {
      toast.error("Could not save memory", errorMessage(error, "Please try again."));
    }
  };
  const remove = (item: MemoryItem) => setPendingDelete(item);
  const confirmRemove = async () => {
    if (!pendingDelete) return;
    const item = pendingDelete;
    setDeleting(true);
    try {
      await apiJson(
        "/api/agent/memory",
        { method: "DELETE", json: { namespace: item.namespace, key: item.key, confirm: true } },
        "Could not delete memory",
      );
      await refreshNamespaces();
      await load();
      setPendingDelete(null);
      toast.success("Memory forgotten");
    } catch (error) {
      toast.error("Could not delete memory", errorMessage(error, "Please try again."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="settings-section" id="memory">
      <div className="node-title-row">
        <div>
          <h2>
            <Brain size={17} /> Doot memory
          </h2>
          <p className="muted">Inspect and manage the namespaced JSON memory used by Doot’s tools.</p>
        </div>
        <Button
          tooltip="Store a durable preference"
          variant="outline"
          onClick={() =>
            setEditor({
              namespace: namespace || "preferences",
              key: "",
              value: "{}",
            })
          }
        >
          <Plus size={15} />
          New memory
        </Button>
      </div>
      {namespaces.length ? (
        <>
          <div className="memory-toolbar">
            <select
              aria-label="Memory namespace"
              value={namespace}
              onChange={(event) => {
                setNamespace(event.target.value);
                setPrefix("");
                void load(event.target.value, "");
              }}
            >
              {namespaces.map((item) => (
                <option key={item.namespace} value={item.namespace}>
                  {item.namespace} ({item.count})
                </option>
              ))}
            </select>
            <Input
              value={prefix}
              placeholder="Filter by key prefix"
              onChange={(event) => setPrefix(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && load()}
            />
            <Button size="icon" variant="outline" tooltip="Filter memory by key" onClick={() => load()}>
              <Search size={15} />
            </Button>
          </div>
          <div className="memory-list">
            {loading ? (
              <p className="muted">Loading memory…</p>
            ) : items.length ? (
              items.map((item) => (
                <div className="memory-row" key={`${item.namespace}:${item.key}`}>
                  <div className="memory-row-head">
                    <div>
                      <Badge>{item.namespace}</Badge>
                      <strong>{item.key}</strong>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        tooltip="Change this remembered value"
                        onClick={() =>
                          setEditor({
                            originalKey: item.key,
                            namespace: item.namespace,
                            key: item.key,
                            value: JSON.stringify(item.value, null, 2),
                          })
                        }
                      >
                        <Pencil size={13} />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        tooltip="Remove this remembered value"
                        onClick={() => remove(item)}
                      >
                        <Trash2 size={13} />
                        Forget
                      </Button>
                    </div>
                  </div>
                  <pre>{JSON.stringify(item.value, null, 2)}</pre>
                  <span className="muted">
                    Updated <LocalTime value={item.updated_at} />
                  </span>
                </div>
              ))
            ) : (
              <p className="muted">No keys match this prefix.</p>
            )}
          </div>
        </>
      ) : (
        <div className="memory-empty">
          <Brain size={24} />
          <p>No Doot memory has been stored yet.</p>
          <span className="muted">
            Doot can remember stable preferences and corrections during future runs, or you can create a JSON value now.
          </span>
        </div>
      )}
      <Dialog
        open={Boolean(editor)}
        title={editor?.originalKey ? "Edit Doot memory" : "Create Doot memory"}
        onClose={() => setEditor(null)}
      >
        {editor && (
          <div className="form-grid">
            <div>
              <Label>Namespace</Label>
              <Input
                value={editor.namespace}
                disabled={Boolean(editor.originalKey)}
                onChange={(event) => setEditor({ ...editor, namespace: event.target.value })}
              />
            </div>
            <div>
              <Label>Key</Label>
              <Input value={editor.key} onChange={(event) => setEditor({ ...editor, key: event.target.value })} />
            </div>
            <div className="field-wide">
              <Label>JSON value</Label>
              <Textarea
                className="memory-editor"
                value={editor.value}
                onChange={(event) => setEditor({ ...editor, value: event.target.value })}
              />
            </div>
            <div className="field-wide memory-dialog-actions">
              <Button variant="outline" tooltip="Discard memory value changes" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button tooltip="Store this durable memory value" onClick={save}>
                Save memory
              </Button>
            </div>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Forget memory?"
        description={
          <>
            <p>
              Forget{" "}
              <strong>
                {pendingDelete?.namespace}/{pendingDelete?.key}
              </strong>
              ?
            </p>
            <p className="muted">This local memory value cannot be recovered.</p>
          </>
        }
        confirmLabel="Forget memory"
        dangerous
        busy={deleting}
        onConfirm={() => void confirmRemove()}
        onClose={() => setPendingDelete(null)}
      />
    </Card>
  );
}
