"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Workspace", matches: (path: string) => path === "/" },
  { href: "/inbox", label: "Inbox", matches: (path: string) => path.startsWith("/inbox") },
  { href: "/flows", label: "Flows", matches: (path: string) => path.startsWith("/flows") || path.startsWith("/rules") },
  { href: "/history", label: "History", matches: (path: string) => path.startsWith("/history") },
  { href: "/settings", label: "Settings", matches: (path: string) => path.startsWith("/settings") },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Primary navigation">
      {items.map((item) => {
        const active = item.matches(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
