import type { Metadata } from "next";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = { title: "Atendimento" };

// The conversation with the agent comes in feature 2. Until then the page has only its bar.
export default function AttendancePage() {
  return (
    <>
      <TopBar here="Atendimento" />
      <main className="flex-1" />
    </>
  );
}
