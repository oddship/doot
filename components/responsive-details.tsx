"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Secondary context is one tap away on phones and expanded on larger screens. */
export function ResponsiveDetails({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const element = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setOpen(true);
      return;
    }
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      if (query.matches && element.current?.contains(document.activeElement))
        element.current.querySelector("summary")?.focus();
      setOpen(!query.matches);
    };
    sync();
    query.addEventListener?.("change", sync);
    return () => query.removeEventListener?.("change", sync);
  }, []);
  return (
    <details
      ref={element}
      className={`responsive-details ${className}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{label}</summary>
      <div className="responsive-details-content">{children}</div>
    </details>
  );
}
