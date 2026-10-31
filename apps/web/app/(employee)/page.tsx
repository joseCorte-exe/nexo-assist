import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { TopBar } from "@/components/top-bar";
import { firstName } from "@/lib/format";
import { requireSession } from "@/lib/server/current-session";
import { loadConversation } from "@/lib/server/conversation";
import { getDeps } from "@/lib/server/deps";
import { confirmShortcut } from "@/lib/shortcut";
import { AssistantStatus } from "./chat/assistant-status";
import { Chat } from "./chat/chat";
import { ChatStatusProvider } from "./chat/chat-status";

export const metadata: Metadata = { title: "Atendimento" };

export default async function AttendancePage() {
  await connection();
  const session = await requireSession("employee");
  // Same data as GET /api/conversation, read here so the chat opens with its history, without a spinner.
  const initial = await loadConversation(getDeps(), session.id);
  const request = await headers();
  const shortcut = confirmShortcut({ platform: request.get("sec-ch-ua-platform"), userAgent: request.get("user-agent") });

  return (
    <ChatStatusProvider initial={initial.conversation}>
      <TopBar here="Atendimento">
        <AssistantStatus />
      </TopBar>
      <Chat initial={initial} employeeName={firstName(session.name)} shortcut={shortcut} />
    </ChatStatusProvider>
  );
}
