import type { Metadata } from "next";
import { AppStateProvider } from "@/components/app-state-provider";
import { getAppState } from "@/lib/app-state";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { FeedbackProvider } from "@/components/feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Doot — your email emissary",
  description: "A trusted local email emissary by Oddship",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider>
          <AppStateProvider state={getAppState()}>
            <AppHeader />
            {children}
          </AppStateProvider>
        </FeedbackProvider>
      </body>
    </html>
  );
}
