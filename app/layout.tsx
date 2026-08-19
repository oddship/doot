import type { Metadata } from "next";
import "./globals.css";
import { AppHeader } from "@/components/app-header";
import { FeedbackProvider } from "@/components/feedback";

export const metadata: Metadata = {
  title: "Doot — your email emissary",
  description: "A trusted local email emissary by Oddship",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FeedbackProvider>
          <AppHeader />
          {children}
        </FeedbackProvider>
      </body>
    </html>
  );
}
