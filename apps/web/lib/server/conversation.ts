import type { ChatMessage, ConversationResponse } from "@nexo/shared";
import { and, asc, eq, ne } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import type { Db } from "@/db";
import { conversations, decisions, messages } from "@/db/schema";
import type { Deps } from "./deps";
import { readEmployeeSession } from "./http";

/** Each employee has at most one conversation that is not closed. The partial unique index answers this lookup. */
export const activeConversationOf = (employeeId: string) =>
  and(eq(conversations.employeeId, employeeId), ne(conversations.state, "closed"));

/**
 * The active conversation of the employee with every message and the decision of each agent reply,
 * in two queries. The chat page and GET /api/conversation both read it from here.
 */
export async function loadConversation(db: Db, employeeId: string): Promise<ConversationResponse> {
  const [conversation] = await db
    .select({ id: conversations.id, state: conversations.state, messageCount: conversations.messageCount })
    .from(conversations)
    .where(activeConversationOf(employeeId))
    .limit(1);
  if (!conversation) return { conversation: null, messages: [] };

  const rows = await db
    .select({
      id: messages.id,
      author: messages.author,
      text: messages.text,
      createdAt: messages.createdAt,
      decisionId: decisions.id,
      understanding: decisions.understanding,
      action: decisions.action,
      confidence: decisions.confidence,
      reason: decisions.reason,
      toolsUsed: decisions.toolsUsed,
    })
    .from(messages)
    .leftJoin(decisions, eq(decisions.messageId, messages.id))
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(asc(messages.createdAt));

  return {
    conversation,
    messages: rows.map(
      ({ id, author, text, createdAt, decisionId, understanding, action, confidence, reason, toolsUsed }): ChatMessage => ({
        id,
        author,
        text,
        createdAt: createdAt.toISOString(),
        decision:
          decisionId === null
            ? null
            : { understanding: understanding ?? "", action: action ?? "", confidence, reason, toolsUsed: toolsUsed ?? [] },
      }),
    ),
  };
}

/** GET /api/conversation. The chat reads it again when the page comes back. */
export async function conversationHandler(request: NextRequest, deps: Deps) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  return NextResponse.json<ConversationResponse>(await loadConversation(deps.db, session.session.id), {
    headers: { "cache-control": "private, no-store" },
  });
}
