import type { ConversationResponse, ConversationView } from "@nexo/shared";
import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { conversations, messages } from "@/db/schema";
import type { Deps } from "./deps";
import { draftsOf, toDraftView } from "./drafts";
import { readEmployeeSession } from "./http";
import { toUIMessage } from "./messages";

/** Each employee has at most one conversation that is not closed. The partial unique index answers this lookup. */
export const activeConversationOf = (employeeId: string) =>
  and(eq(conversations.employeeId, employeeId), ne(conversations.state, "closed"));

/** What the chat needs of the conversation row. */
export const viewColumns = {
  id: conversations.id,
  state: conversations.state,
  messageCount: conversations.messageCount,
  targetLevel: conversations.targetLevel,
  waitUntil: conversations.waitUntil,
  analystId: conversations.analystId,
};

type ViewRow = { [Key in keyof typeof viewColumns]: (typeof conversations.$inferSelect)[Key] };

/**
 * The conversation as the chat shows it: who it waits for, until when, and who attends it, by the name and level the
 * directory has now. Only a conversation an analyst attends asks the directory; down, the chat says "o analista".
 */
export async function toConversationView(deps: Pick<Deps, "directory">, { analystId, waitUntil, ...row }: ViewRow): Promise<ConversationView> {
  const analyst = analystId ? (await deps.directory.analysts())?.get(analystId) : undefined;
  return {
    ...row,
    waitUntil: waitUntil?.toISOString() ?? null,
    analyst: analyst ? { name: analyst.name, level: analyst.level } : null,
  };
}

/**
 * The conversation of the employee with its messages and drafts, in two round trips: the active one, or the one the chat
 * shows, by id, even closed, so the chat sees the analyst close it. Somebody else's conversation is never found. The chat
 * page and GET /api/conversation both read it from here.
 */
export async function loadConversation(
  deps: Pick<Deps, "db" | "directory">,
  employeeId: string,
  conversationId?: string,
): Promise<ConversationResponse> {
  const { db } = deps;
  const [conversation] = await db
    .select(viewColumns)
    .from(conversations)
    .where(
      conversationId
        ? and(eq(conversations.id, conversationId), eq(conversations.employeeId, employeeId))
        : activeConversationOf(employeeId),
    )
    .limit(1);
  if (!conversation) return { conversation: null, messages: [], drafts: [] };

  // One round trip for both. The notes of what she did in a card are system messages without an event: the card shows
  // it instead. The notes of the console have one.
  const [rows, draftRows] = await db.batch([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), or(ne(messages.author, "system"), isNotNull(messages.event))))
      .orderBy(asc(messages.createdAt)),
    draftsOf(db, conversation.id),
  ]);
  const [view, shown] = await Promise.all([toConversationView(deps, conversation), Promise.all(rows.map(toUIMessage))]);
  return { conversation: view, drafts: draftRows.map(toDraftView), messages: shown };
}

/** GET /api/conversation?conversationId=. The chat reads it again when the page comes back, and while an analyst has it. */
export async function conversationHandler(request: NextRequest, deps: Deps) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const conversationId = request.nextUrl.searchParams.get("conversationId") ?? undefined;
  return NextResponse.json<ConversationResponse>(await loadConversation(deps, session.session.id, conversationId), {
    headers: { "cache-control": "private, no-store" },
  });
}
