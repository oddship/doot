"use client";
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui";

const dialogs: HTMLElement[] = [];
let previousOverflow = "";
export function Dialog({
  open,
  title,
  children,
  onClose,
  closeDisabled = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef({ onClose, closeDisabled });
  useLayoutEffect(() => {
    close.current = { onClose, closeDisabled };
  }, [onClose, closeDisabled]);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const node = panel.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialogs.length) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    dialogs.push(node);
    const focusable = () =>
      [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ].filter((element) => !element.hidden && getComputedStyle(element).display !== "none");
    (focusable()[0] || node).focus();
    const keydown = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== node) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!close.current.closeDisabled) close.current.onClose();
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0] || node;
      const last = elements.at(-1) || node;
      if (
        !node.contains(document.activeElement) ||
        (event.shiftKey ? document.activeElement === first : document.activeElement === last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      const wasTop = dialogs.at(-1) === node;
      dialogs.splice(dialogs.indexOf(node), 1);
      document.removeEventListener("keydown", keydown);
      if (!dialogs.length) document.body.style.overflow = previousOverflow;
      if (wasTop && previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div ref={panel} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <Button
            type="button"
            variant="ghost"
            tooltip="Close this dialog"
            tooltipSide="top"
            disabled={closeDisabled}
            onClick={onClose}
          >
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
