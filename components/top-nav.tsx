"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { flushAppStateWrites } from "@/lib/client-app-state";
import { navigateClient } from "@/lib/client-navigation";

const items = [
  { href: "/", label: "Workspace", matches: (path: string) => path === "/" },
  { href: "/inbox", label: "Inbox", matches: (path: string) => path.startsWith("/inbox") },
  { href: "/drafts", label: "Drafts", matches: (path: string) => path.startsWith("/drafts") },
  { href: "/flows", label: "Flows", matches: (path: string) => path.startsWith("/flows") || path.startsWith("/rules") },
  { href: "/history", label: "History", matches: (path: string) => path.startsWith("/history") },
  { href: "/settings", label: "Settings", matches: (path: string) => path.startsWith("/settings") },
];

export function TopNav({ activePath, onNavigate }: { activePath?: string; onNavigate?: (path: string) => void } = {}) {
  const pathname = usePathname();
  const currentPath = activePath || pathname;
  return (
    <nav className="nav" aria-label="Primary navigation">
      {items.map((item) => {
        const active = item.matches(currentPath);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              void flushAppStateWrites()
                .then(() => (onNavigate ? onNavigate(item.href) : navigateClient(item.href)))
                .catch(() => {});
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
