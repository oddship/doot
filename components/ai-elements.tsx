"use client";
import { Brain, CheckCircle2, LoaderCircle, Paperclip, Send, Wrench, XCircle } from "lucide-react";
import Image from "next/image";
import type { FormEvent, ReactNode } from "react";
import { Button, Card, cn, Textarea } from "@/components/ui";

export function Conversation({ children }: { children: ReactNode }) {
  return (
    <div className="conversation" aria-live="polite">
      {children}
    </div>
  );
}
export function ConversationEmpty() {
  return (
    <div className="conversation-empty">
      <Image className="agent-mark" src="/doot-mark.svg" alt="" width={44} height={44} />
      <h2>Start with a task</h2>
      <p>Try “find last month’s receipts,” or select messages in Inbox and return here to discuss them.</p>
    </div>
  );
}
export function Message({ role, children }: { role: "user" | "assistant" | "system"; children: ReactNode }) {
  return (
    <div className={cn("message", `message-${role}`)}>
      <span className="message-role">{role === "assistant" ? "Doot" : role}</span>
      <div>{children}</div>
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
export function ToolCall({
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
}
export function TaskStatus({ status, detail }: { status: string; detail: ReactNode }) {
  return (
    <div className={cn("task-status", `task-${status}`)}>
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
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="prompt-box" onSubmit={submit}>
      <Textarea
        aria-label="Message Doot"
        placeholder="Ask Doot about your cached mail…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
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
