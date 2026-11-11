"use client";
import { Brain, CheckCircle2, LoaderCircle, Paperclip, Send, Wrench, XCircle } from "lucide-react";
import Image from "next/image";
import { type FormEvent, memo, type ReactNode, useEffect, useRef } from "react";
import { Button, Card, cn, EmptyState, Textarea } from "@/components/ui";

export function Conversation({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame: number | undefined;
    const follow = () => {
      if (frame !== undefined || !followLatest.current) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        element.scrollTop = element.scrollHeight;
      });
    };
    const observer = new MutationObserver(follow);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    follow();
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div
      ref={container}
      className="conversation"
      role="log"
      aria-live="off"
      aria-label="Conversation history"
      onScroll={() => {
        const element = container.current;
        if (element) followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      }}
    >
      {children}
    </div>
  );
}
export function ConversationEmpty() {
  return (
    <div className="conversation-empty">
      <Image className="agent-mark" src="/doot-mark.svg" alt="" width={44} height={44} />
      <EmptyState
        title="Make room for what matters"
        description="Find receipts, catch up on unread email, or prepare a cleanup. Doot asks you to review mailbox changes before applying them."
      >
        <a className="button outline button-outline" href="/inbox">
          Browse email
        </a>
        <a className="button ghost button-ghost" href="/settings#accounts">
          Connect an account
        </a>
      </EmptyState>
    </div>
  );
}
export function Message({ role, children }: { role: "user" | "assistant" | "system"; children: ReactNode }) {
  return (
    <div className={cn("message", `message-${role}`)} data-message={role}>
      <span className="message-role">{role === "assistant" ? "Doot" : role}</span>
      <div data-message-body>{children}</div>
    </div>
  );
}
export function Reasoning({ text, active }: { text?: string; active?: boolean }) {
  if (!text && !active) return null;
  return (
    <details className="reasoning" open={active}>
      <summary>
        <Brain size={15} /> {active ? "Reasoning" : "Reasoning complete"}
      </summary>
      {text && <p>{text}</p>}
    </details>
  );
}
export const ToolCall = memo(function ToolCall({
  name,
  state,
  detail,
}: {
  name: string;
  state: "running" | "complete" | "error";
  detail?: string;
}) {
  return (
    <Card className="tool-call">
      <span className="tool-icon">
        <Wrench size={15} />
      </span>
      <div>
        <strong>{name.replaceAll("_", " ")}</strong>
        <p>
          {detail || (state === "running" ? "Working with local data…" : state === "complete" ? "Completed" : "Failed")}
        </p>
      </div>
      {state === "running" ? (
        <LoaderCircle className="spin" size={16} />
      ) : state === "error" ? (
        <XCircle size={16} />
      ) : (
        <CheckCircle2 size={16} />
      )}
    </Card>
  );
});

export function TaskStatus({ status, detail }: { status: string; detail: ReactNode }) {
  return (
    <div className={cn("task-status", `task-${status}`)} role="status" aria-live="polite">
      {status === "running" || status === "tool" ? (
        <LoaderCircle className="spin" size={15} />
      ) : status === "error" ? (
        <XCircle size={15} />
      ) : (
        <CheckCircle2 size={15} />
      )}
      <span>{detail}</span>
    </div>
  );
}
export function Artifact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="artifact">
      <span>
        <Paperclip size={15} />
      </span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </Card>
  );
}
export function PromptInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const resize = () => {
      const input = form.current?.querySelector("textarea");
      if (!input) return;
      if (window.innerWidth > 900) {
        input.style.removeProperty("height");
        return;
      }
      input.style.height = "0px";
      input.style.height = `${Math.min(128, Math.max(44, input.scrollHeight))}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled && value.trim()) onSubmit();
  };
  return (
    <form className="prompt-box" ref={form} onSubmit={submit}>
      <Textarea
        aria-label="Message Doot"
        placeholder="Ask Doot…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!disabled && value.trim()) onSubmit();
          }
        }}
      />
      <Button
        size="icon"
        aria-label="Send"
        tooltip="Send message to Doot"
        tooltipSide="top"
        disabled={disabled || !value.trim()}
      >
        <Send size={17} />
      </Button>
    </form>
  );
}
