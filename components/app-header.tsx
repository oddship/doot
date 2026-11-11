"use client";

import { Menu, RefreshCw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SyncButton } from "@/components/sync-button";
import { navigationItems, TopNav } from "@/components/top-nav";
import { Button, Dialog } from "@/components/ui";
import { flushAppStateWrites } from "@/lib/client-app-state";
import { navigateClient } from "@/lib/client-navigation";

export function AppHeader({
  activePath,
  onNavigate,
  logoPath = "/doot-mark.svg",
}: {
  activePath?: string;
  onNavigate?: (path: string) => void;
  logoPath?: string;
}) {
  const header = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const currentPath = activePath || pathname;
  const pageName = navigationItems.find((item) => item.matches(currentPath))?.label || "Doot";
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [currentPath]);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    const measure = () =>
      document.documentElement.style.setProperty("--app-header-height", `${element.getBoundingClientRect().height}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <header className="topbar" ref={header}>
        <Button
          className="mobile-menu-button"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={22} />
        </Button>
        <span className="mobile-page-name">{pageName}</span>
        <Link
          href="/"
          className="brand"
          aria-label="Doot home"
          onClick={(event) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void flushAppStateWrites()
              .then(() => (onNavigate ? onNavigate("/") : navigateClient("/")))
              .catch(() => {});
          }}
        >
          <Image className="brand-mark" src={logoPath} alt="" width={32} height={32} priority />
          <span className="brand-copy">
            <strong>Doot</strong>
            <small>by oddship</small>
          </span>
        </Link>
        <div className="desktop-navigation">
          <TopNav activePath={activePath} onNavigate={onNavigate} />
        </div>
        <div className="top-actions">
          <SyncButton icon={<RefreshCw size={15} />} />
        </div>
      </header>
      <Dialog open={menuOpen} title="Doot navigation" onClose={() => setMenuOpen(false)}>
        <TopNav
          id="mobile-navigation"
          className="mobile-navigation"
          activePath={currentPath}
          onNavigate={(path) => {
            setMenuOpen(false);
            if (onNavigate) onNavigate(path);
            else navigateClient(path);
          }}
        />
      </Dialog>
    </>
  );
}
