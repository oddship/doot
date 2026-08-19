"use client";

import { RefreshCw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { SyncButton } from "@/components/sync-button";
import { TopNav } from "@/components/top-nav";

export function AppHeader({
  activePath,
  onNavigate,
  logoPath = "/doot-mark.svg",
}: {
  activePath?: string;
  onNavigate?: (path: string) => void;
  logoPath?: string;
}) {
  return (
    <header className="topbar">
      <Link
        href="/"
        className="brand"
        aria-label="Doot home"
        onClick={
          onNavigate
            ? (event) => {
                event.preventDefault();
                onNavigate("/");
              }
            : undefined
        }
      >
        <Image className="brand-mark" src={logoPath} alt="" width={32} height={32} priority />
        <span className="brand-copy">
          <strong>Doot</strong>
          <small>by oddship</small>
        </span>
      </Link>
      <TopNav activePath={activePath} onNavigate={onNavigate} />
      <div className="top-actions">
        <SyncButton icon={<RefreshCw size={15} />} />
      </div>
    </header>
  );
}
