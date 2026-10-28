import type { Metadata } from "next";
import { connection } from "next/server";
import { TopBar } from "@/components/top-bar";
import { firstName } from "@/lib/format";
import { requireSession } from "@/lib/server/current-session";
import { loadConversation } from "@/lib/server/conversation";
import { getDeps } from "@/lib/server/deps";
import { AssistantStatus } from "./chat/assistant-status";
import { Chat } from "./chat/chat";

export const metadata: Metadata = { title: "Atendimento" };

export default async function AttendancePage() {
  await connection();
  const session = await requireSession("employee");
  // Same data as GET /api/conversation, read here so the chat opens with its history, without a spinner.
  const initial = await loadConversation(getDeps().db, session.id);

  return (
    <>
      <TopBar here="Atendimento">
        <AssistantStatus />
      </TopBar>
      <Chat initial={initial} employeeName={firstName(session.name)} />
    </>
  );
}
