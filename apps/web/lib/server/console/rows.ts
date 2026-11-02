import type { Analyst, AnalystSign, ConsoleConversation, Employee } from "@nexo/shared";
import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { consoleReads, conversations, messages } from "@/db/schema";

// A conversation as the console reads it: the row, how many of her messages this analyst has not read, and the last
// message she or he can read. Everything comes in the query itself, so a page is one round trip whatever its size.

/** The chat counts as open while it said so in this window; it says so every 20 s while the tab is visible. */
export const ONLINE_MS = 45_000;

/**
 * Her messages this analyst has not read. Only a conversation that needs an analyst has any: waiting for one, or this
 * one's. They count from the later of two moments: when this analyst last read it, and when it started needing an
 * analyst this time (the last answer before the message of hers that led to the transfer, so what she wrote counts; or
 * the moment this analyst assumed it). A read from an earlier transfer of the same conversation does not hide the new one.
 */
const unread = (analystId: string) => sql<number>`case
  when ${conversations.state} = 'waiting_for_analyst' or (${conversations.state} = 'with_analyst' and ${conversations.analystId} = ${analystId})
  then (select count(*) from ${messages} e where e.conversation_id = ${conversations.id} and e.author = 'employee' and e.created_at > max(
    coalesce(${consoleReads.readAt}, 0),
    case when ${conversations.state} = 'with_analyst' then coalesce(${conversations.assumedAt}, 0)
    else coalesce((select max(a.created_at) from ${messages} a
          where a.conversation_id = ${conversations.id} and a.author in ('agent', 'analyst') and a.created_at < (
            select max(l.created_at) from ${messages} l
            where l.conversation_id = ${conversations.id} and l.author = 'employee' and l.created_at <= coalesce(${conversations.transferredAt}, 0))), 0)
    end))
  else 0 end`;

/** The last message she or he can read, without the notes, on the index of (conversation, created_at). */
const lastMessage = sql<string | null>`(select json_object('author', m.author, 'text', m.text, 'at', m.created_at)
  from ${messages} m where m.conversation_id = ${conversations.id} and m.author <> 'system'
  order by m.created_at desc limit 1)`;

/** The conversations matching where, as the console reads them for this analyst. */
export function conversationRows(db: Db, analystId: string, where: SQL | undefined) {
  return db
    .select({
      conversation: conversations,
      unread: unread(analystId),
      lastMessage,
    })
    .from(conversations)
    .leftJoin(consoleReads, and(eq(consoleReads.conversationId, conversations.id), eq(consoleReads.analystId, analystId)))
    .where(where);
}

export type ConversationRow = Awaited<ReturnType<typeof conversationRows>>[number];

const signOf = (analyst: Analyst | undefined): AnalystSign | null =>
  analyst ? { id: analyst.id, name: analyst.name, level: analyst.level } : null;

/** The row as the contract says it, with the names the ticket-service gave. */
export function toConsoleConversation(
  { conversation: c, unread: count, lastMessage: last }: ConversationRow,
  { employee, analysts, now }: { employee: Employee | undefined; analysts: Map<string, Analyst>; now: Date },
): ConsoleConversation {
  const preview = last ? (JSON.parse(last) as { author: "employee" | "agent" | "analyst"; text: string; at: number }) : null;
  const seenAt = c.employeeSeenAt?.getTime() ?? 0;
  return {
    id: c.id,
    employee: { id: c.employeeId, name: employee?.name ?? "Funcionário", department: employee?.department ?? "" },
    state: c.state,
    outcome: c.outcome,
    targetLevel: c.targetLevel,
    transferReason: c.transferReason,
    transferConfidence: c.transferConfidence,
    ticketId: c.ticketId,
    waitUntil: c.waitUntil?.toISOString() ?? null,
    transferredAt: c.transferredAt?.toISOString() ?? null,
    assumedAt: c.assumedAt?.toISOString() ?? null,
    analyst: c.analystId ? signOf(analysts.get(c.analystId)) : null,
    lastActivityAt: (c.lastActivityAt ?? c.createdAt).toISOString(),
    preview: preview && {
      author: preview.author,
      text: preview.text,
      at: new Date(preview.at).toISOString(),
      // A reply she was on the chat after: the double check turns blue.
      seen: preview.author !== "employee" && seenAt >= preview.at,
    },
    unread: Number(count),
    online: now.getTime() - seenAt <= ONLINE_MS,
    typing: (c.employeeTypingUntil?.getTime() ?? 0) > now.getTime(),
  };
}
