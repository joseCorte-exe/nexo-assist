import type { Metadata } from "next";

export const metadata: Metadata = { title: "Console" };

// The conversation list, the history and the tickets panel come in feature 5.
export default function ConsolePage() {
  return <main className="flex-1" />;
}
