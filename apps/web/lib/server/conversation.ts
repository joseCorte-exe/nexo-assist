import { conversationPart, type ConversationResponse, type NexoUIMessage, nexoToolSchemas } from "@nexo/shared";
import { safeValidateUIMessages } from "ai";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";
import type { Deps } from "./deps";
import { readEmployeeSession } from "./http";

/** Each employee has at most one conversation that is not closed. The partial unique index answers this lookup. */
export const activeConversationOf = (employeeId: string) =>
  and(eq(conversations.employeeId, employeeId), ne(conversations.state, "closed"));

/**
 * The active conversation of the employee with its messages, in two queries. An agent reply comes with the parts it
 * streamed, decision included, so the chat draws it as it did live. The chat page and GET /api/conversation both
 * read it from here.
 */
export async function loadConversation(db: Db, employeeId: string): Promise<ConversationResponse> {
  const [conversation] = await db
    .select({ id: conversations.id, state: conversations.state, messageCount: conversations.messageCount })
    .from(conversations)
    .where(activeConversationOf(employeeId))
    .limit(1);
  if (!conversation) return { conversation: null, messages: [] };

  const rows = await db
    .select({ id: messages.id, author: messages.author, text: messages.text, parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.conversationId, conversation.id), inArray(messages.author, ["employee", "agent"])))
    .orderBy(asc(messages.createdAt));

  // Analyst and system messages come with the console, in feature 5.
  return {
    conversation,
    messages: await Promise.all(
      rows.map(async ({ id, author, text, parts }): Promise<NexoUIMessage> => {
        const asText: NexoUIMessage = { id, role: author === "employee" ? "user" : "assistant", parts: [{ type: "text", text }] };
        return parts ? savedReply({ ...asText, parts }, asText) : asText;
      }),
    ),
  };
}

/**
 * The parts are what the AI SDK streamed, saved as JSON: checked against the schemas of the tools when read, so a
 * change of format shows up here and not on the screen. A reply that no longer matches is shown as its saved text.
 */
async function savedReply(message: NexoUIMessage, asText: NexoUIMessage): Promise<NexoUIMessage> {
  const checked = await safeValidateUIMessages<NexoUIMessage>({
    messages: [message],
    dataSchemas: { conversation: conversationPart },
    tools: nexoToolSchemas,
  });
  if (checked.success) return checked.data[0]!;
  // Only the kind of error: its details can quote what the employee wrote.
  console.error("saved reply does not match the chat format", { messageId: message.id, error: checked.error.name });
  return asText;
}

/** GET /api/conversation. The chat reads it again when the page comes back. */
export async function conversationHandler(request: NextRequest, deps: Deps) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  return NextResponse.json<ConversationResponse>(await loadConversation(deps.db, session.session.id), {
    headers: { "cache-control": "private, no-store" },
  });
}
