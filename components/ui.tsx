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
    "aria-label": ariaLabel,
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
      aria-label={ariaLabel || (size === "icon" ? tooltip : undefined)}
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
  const id = React.useId();
  const child = React.isValidElement(children)
    ? (children as React.ReactElement<{ "aria-describedby"?: string }>)
    : null;
  return (
    <span className="tooltip-root" data-side={side}>
      {child
        ? React.cloneElement(child, {
            "aria-describedby": [child.props["aria-describedby"], id].filter(Boolean).join(" "),
          })
        : children}
      <span id={id} className="tooltip-content" role="tooltip">
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
export { Dialog } from "@/components/dialog";
export function Tabs({
  tabs,
  value,
  onChange,
  id,
}: {
  tabs: string[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const generatedId = React.useId();
  const base = id || generatedId;
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab, index) => (
        <button
          type="button"
          key={tab}
          role="tab"
          id={`${base}-tab-${index}`}
          aria-selected={value === tab}
          aria-controls={`${base}-panel-${index}`}
          tabIndex={value === tab ? 0 : -1}
          onKeyDown={(event) => {
            const target =
              event.key === "ArrowRight"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft"
                  ? (index + tabs.length - 1) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : -1;
            if (target < 0) return;
            event.preventDefault();
            onChange(tabs[target]);
            document.getElementById(`${base}-tab-${target}`)?.focus();
          }}
          className={value === tab ? "active" : ""}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
