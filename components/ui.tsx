import * as React from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "default" | "outline" | "ghost" | "danger";
    size?: "default" | "sm" | "icon";
  }
>(function Button({ className, variant = "default", size = "default", ...props }, ref) {
  return <button ref={ref} className={cn("button", `button-${variant}`, `button-${size}`, className)} {...props} />;
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
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input", props.className)} {...props} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea", props.className)} {...props} />;
}
export function Label(props: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("label", props.className)} {...props} />;
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}
export function Separator() {
  return <div className="separator" />;
}
export function Dialog({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Sheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </aside>
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
