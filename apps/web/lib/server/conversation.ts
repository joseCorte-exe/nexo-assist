import {
  analystPart,
  chatNote,
  conversationPart,
  type ConversationResponse,
  type ConversationView,
  type NexoUIMessage,
  nexoToolSchemas,
} from "@nexo/shared";
import { safeValidateUIMessages } from "ai";
import { and, asc, eq, isNotNull, ne, or } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";
import type { Deps } from "./deps";
import { draftsOf, toDraftView } from "./drafts";
import { readEmployeeSession } from "./http";

/** Each employee has at most one conversation that is not closed. The partial unique index answers this lookup. */
export const activeConversationOf = (employeeId: string) =>
  and(eq(conversations.employeeId, employeeId), ne(conversations.state, "closed"));

type MessageRow = Pick<typeof messages.$inferSelect, "id" | "author" | "text" | "parts">;

/**
 * The conversation of the employee with its messages and drafts, in two round trips: the active one, or the one the chat
 * shows, by id, even closed, so the chat sees the analyst close it. Somebody else's conversation is never found. An agent
 * reply comes with the parts it streamed, decision included, so the chat draws it as it did live; an analyst message and
 * a note of the console come with the parts they were saved with. The chat page and GET /api/conversation both read it
 * from here.
 */
export async function loadConversation(deps: Pick<Deps, "db">, employeeId: string, conversationId?: string): Promise<ConversationResponse> {
  const { db } = deps;
  const [conversation] = await db
    .select({
      id: conversations.id,
      state: conversations.state,
      messageCount: conversations.messageCount,
      targetLevel: conversations.targetLevel,
      waitUntil: conversations.waitUntil,
      analystId: conversations.analystId,
    })
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
      .select({ id: messages.id, author: messages.author, text: messages.text, parts: messages.parts, authorId: messages.authorId })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), or(ne(messages.author, "system"), isNotNull(messages.event))))
      .orderBy(asc(messages.createdAt)),
    draftsOf(db, conversation.id),
  ]);

  const shown = await Promise.all(rows.map(toUIMessage));
  const { analystId, waitUntil, ...part } = conversation;
  const view: ConversationView = {
    ...part,
    waitUntil: waitUntil?.toISOString() ?? null,
    analyst: analystId ? attendingAnalyst(rows, analystId) : null,
  };
  return { conversation: view, drafts: draftRows.map(toDraftView), messages: shown };
}

/** Who attends, as the note of when they assumed it says: the name and level the employee reads. */
function attendingAnalyst(rows: Array<MessageRow & { authorId: string | null }>, analystId: string) {
  for (const row of [...rows].reverse()) {
    if (row.author !== "system" || row.authorId !== analystId) continue;
    const note = chatNote.safeParse(dataOf(row, "data-note"));
    if (note.success && note.data.event === "assumed" && note.data.analystName && note.data.level) {
      return { name: note.data.analystName, level: note.data.level };
    }
  }
  return null;
}

const dataOf = (row: MessageRow, type: string) => (row.parts?.find((part) => part.type === type) as { data?: unknown } | undefined)?.data;

async function toUIMessage(row: MessageRow): Promise<NexoUIMessage> {
  const { id, author, text, parts } = row;
  const asText: NexoUIMessage = { id, role: author === "employee" ? "user" : "assistant", parts: [{ type: "text", text }] };
  if (author === "system") {
    const note = chatNote.safeParse(dataOf(row, "data-note"));
    return note.success ? { id, role: "system", parts: [{ type: "data-note", data: note.data }] } : { ...asText, role: "system" };
  }
  if (author === "analyst") {
    const sign = analystPart.safeParse(dataOf(row, "data-analyst"));
    return sign.success ? { id, role: "assistant", parts: [{ type: "data-analyst", data: sign.data }, { type: "text", text }] } : asText;
  }
  return author === "agent" && parts ? savedReply({ ...asText, parts }, asText) : asText;
}

/**
 * The parts are what the AI SDK streamed, saved as JSON: checked against the schemas of the tools when read, so a
 * change of format shows up here and not on the screen. A reply that no longer matches is shown as its saved text.
 */
async function savedReply(message: NexoUIMessage, asText: NexoUIMessage): Promise<NexoUIMessage> {
  const checked = await safeValidateUIMessages<NexoUIMessage>({
    messages: [message],
    dataSchemas: { conversation: conversationPart, note: chatNote, analyst: analystPart },
    tools: nexoToolSchemas,
  });
  if (checked.success) return checked.data[0]!;
  // Only the kind of error: its details can quote what the employee wrote.
  console.error("saved reply does not match the chat format", { messageId: message.id, error: checked.error.name });
  return asText;
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
