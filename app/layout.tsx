import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { FeedbackProvider } from "@/components/feedback";
import { SyncButton } from "@/components/sync-button";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Doot — your email emissary",
  description: "A trusted local email emissary by Oddship",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider>
          <header className="topbar">
            <Link href="/" className="brand" aria-label="Doot home">
              <Image className="brand-mark" src="/doot-mark.svg" alt="" width={32} height={32} priority />
              <span className="brand-copy">
                <strong>Doot</strong>
                <small>by oddship</small>
              </span>
            </Link>
            <TopNav />
            <div className="top-actions">
              <SyncButton icon={<RefreshCw size={15} />} />
            </div>
          </header>
          {children}
        </FeedbackProvider>
      </body>
    </html>
  );
}
