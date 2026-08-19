import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Doot demo — your email emissary",
  description: "A frozen, fictional demonstration of Doot by Oddship.",
};

export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const basePath = process.env.NEXT_PUBLIC_DOOT_DEMO_BASE_PATH || "";
  return (
    <html lang="en">
      <head>
        <link rel="icon" href={`${basePath}/doot-mark.svg`} type="image/svg+xml" />
      </head>
      <body>{children}</body>
    </html>
  );
}
