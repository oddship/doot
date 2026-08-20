"use client";

import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Dialog } from "@/components/ui";

type ToastTone = "success" | "error" | "info";
type ToastInput = { title: string; description?: string; tone?: ToastTone; duration?: number };
type ToastItem = ToastInput & { id: number; tone: ToastTone };
type ToastApi = {
  show: (value: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);
let nextToastId = 1;

function ToastCard({ item, dismiss }: { item: ToastItem; dismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(dismiss, item.duration ?? 4_500);
    return () => window.clearTimeout(timer);
  }, [dismiss, item.duration]);
  const Icon = item.tone === "success" ? CheckCircle2 : item.tone === "error" ? AlertTriangle : Info;
  return (
    <div className={`toast toast-${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
      <Icon size={18} />
      <div>
        <strong>{item.title}</strong>
        {item.description && <p>{item.description}</p>}
      </div>
      <button type="button" aria-label="Dismiss notification" onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const show = useCallback((value: ToastInput) => {
    const item = { ...value, id: nextToastId++, tone: value.tone || "info" } as ToastItem;
    setItems((current) => [...current.slice(-3), item]);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: "success" }),
      error: (title, description) => show({ title, description, tone: "error", duration: 7_000 }),
      info: (title, description) => show({ title, description, tone: "info" }),
    }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite">
        {items.map((item) => (
          <ToastCard key={item.id} item={item} dismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside FeedbackProvider");
  return value;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  dangerous = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  dangerous?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} title={title} closeDisabled={busy} onClose={busy ? () => {} : onClose}>
      <div className="confirm-dialog-copy">{description}</div>
      <div className="memory-dialog-actions">
        <Button
          variant="outline"
          tooltip="Close without applying changes"
          tooltipSide="top"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          variant={dangerous ? "danger" : "default"}
          tooltip="Confirm this reviewed action"
          tooltipSide="top"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
