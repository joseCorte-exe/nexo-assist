import type { Metadata } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// The two typefaces of nexo.pen: Newsreader for display, Schibsted Grotesk for the interface.
// Newsreader keeps its optical-size axis, fixed in globals.css to the cut the design uses.
const newsreader = Newsreader({ subsets: ["latin"], axes: ["opsz"], variable: "--font-newsreader", display: "swap" });
const schibsted = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Nexo Assist", template: "%s · Nexo Assist" },
  description: "Service desk de TI da Nexo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${newsreader.variable} ${schibsted.variable}`}>
      <body>{children}</body>
    </html>
  );
}
