import type { Metadata } from "next";
import { AppStateProvider } from "@/components/app-state-provider";
import { getAppState } from "@/lib/app-state";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { BackgroundJobStatus } from "@/components/background-job-status";
import { FeedbackProvider } from "@/components/feedback";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Doot — take control of your email",
  description: "Self-hosted email management. Read, organize, and clear your inbox with changes you review.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider>
          <AppStateProvider
            state={getAppState()}
            header={
              <>
                <AppHeader />
                <BackgroundJobStatus />
              </>
            }
          >
            {children}
          </AppStateProvider>
        </FeedbackProvider>
      </body>
    </html>
  );
}
