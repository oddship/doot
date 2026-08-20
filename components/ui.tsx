import * as React from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "outline" | "ghost" | "danger";
    size?: "default" | "sm" | "icon";
    tooltip?: string;
    tooltipSide?: "top" | "bottom";
    tooltipAlign?: "left" | "center" | "right";
  }
>(function Button(
  {
    className,
    variant = "default",
    size = "default",
    tooltip,
    tooltipSide = "bottom",
    tooltipAlign = "center",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn("button", `button-${variant}`, `button-${size}`, className)}
      data-tooltip={tooltip}
      data-tooltip-side={tooltip ? tooltipSide : undefined}
      data-tooltip-align={tooltip ? tooltipAlign : undefined}
      aria-description={tooltip}
      {...props}
    />
  );
});
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}
export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: string }) {
  return <span className={cn("badge", `badge-${tone}`, className)} {...props} />;
}
export function Tooltip({
  content,
  side = "bottom",
  children,
}: {
  content: string;
  side?: "top" | "bottom";
  children: React.ReactNode;
}) {
  return (
    <span className="tooltip-root" data-side={side}>
      {children}
      <span className="tooltip-content" role="tooltip">
        {content}
      </span>
    </span>
  );
}
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", className)} {...props} />;
}
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea", className)} {...props} />;
}
export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label", props.className)} {...props} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}
export function Dialog({
  open,
  title,
  children,
  onClose,
  closeDisabled = false,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !closeDisabled && onClose()}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <Button
            variant="ghost"
            tooltip={closeDisabled ? undefined : "Close this dialog"}
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
export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab}
          role="tab"
          aria-selected={value === tab}
          className={value === tab ? "active" : ""}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
