import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { themeInitScript } from "@/components/theme-init-script";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isDemo } from "@/features/chat/backend";
import { DemoBanner } from "@/features/demo";
import "./globals.css";

export const metadata: Metadata = {
  title: "Errand agent",
  description: "Books home services through approved, verified actions.",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // Light is rendered by the server, so first paint is light whatever the OS prefers. The head script
    // switches to a saved dark choice before first paint, so React must not warn about data-theme.
    <html lang="en" className="lime" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} id="theme-init" />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <TooltipProvider>
            {children}
            {isDemo && <DemoBanner />}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
