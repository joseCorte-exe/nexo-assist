import { randomUUID } from "node:crypto";
import type { TransferStore } from "@nexo/agent";
import { type ChatNote, LEVEL_LABEL, type NexoUIMessage } from "@nexo/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";

/**
 * The transfers of the agent, in the conversations database (ARQUITETURA.md, section 6). The conversation only moves if
 * it is still with the agent: an analyst may have assumed it while the agent was answering, and then the reply is saved
 * but its transfer does not happen. The note goes in the same batch, written only if the update changed the row
 * (changes() reads the statement before it), so there is never a note without its transfer, nor one twice.
 */
export function createTransferStore(db: Db): TransferStore {
  return {
    transfer: async ({ conversationId, level, reason, summary, ticketId, waitUntil, at }) => {
      const noteId = `note-${conversationId}-transferred-${randomUUID()}`;
      const note: ChatNote = { event: "transferred", level, analystName: null, at: at.toISOString() };
      const [moved] = await db.batch([
        db
          .update(conversations)
          .set({
            state: "waiting_for_analyst",
            targetLevel: level,
            transferReason: reason,
            transferSummary: summary,
            transferConfidence: null,
            ticketId,
            waitUntil,
            transferredAt: at,
            analystId: null,
            assumedAt: null,
          })
          .where(and(eq(conversations.id, conversationId), eq(conversations.state, "with_agent")))
          .returning({ id: conversations.id }),
        noteIfMoved(db, { noteId, conversationId, authorId: null, text: `Transferida para o ${LEVEL_LABEL[level]}.`, note }),
      ]);
      return moved.length === 1 ? { transferred: true, noteId } : { transferred: false };
    },
  };
}

/**
 * The parts a note of the console is saved with: what happened, the level and who, as they were then. The chat and the
 * console draw the note from them, so a later name or level never rewrites the history.
 */
export const notePart = (note: ChatNote): NexoUIMessage["parts"] => [{ type: "data-note", data: note }];

/**
 * The note of a move of the console or of a transfer, written in the batch right after the conditional update that
 * moves the conversation, and only if that update changed the row: changes() reads the statement before it. There is
 * never a note without its move, nor two notes for one move.
 */
export function noteIfMoved(
  db: Db,
  { noteId, conversationId, authorId, text, note }: { noteId: string; conversationId: string; authorId: string | null; text: string; note: ChatNote },
) {
  return db.run(sql`
    insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
    select ${noteId}, ${conversationId}, 'system', ${authorId}, ${note.event}, ${text}, ${JSON.stringify(notePart(note))}, ${new Date(note.at).getTime()}
    where changes() = 1`);
}

/**
 * The note of a transfer is written while the agent answers, before its reply is saved; this moves it right after the
 * reply that announced it, where nexo.pen draws it. Only while the conversation still waits: if an analyst took it
 * meanwhile, the note stays before the one of the analyst.
 */
export function noteAfterReply(db: Db, { conversationId, since, replyAt }: { conversationId: string; since: Date; replyAt: Date }) {
  return db
    .update(messages)
    .set({ createdAt: new Date(replyAt.getTime() + 1) })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.event, "transferred"),
        gte(messages.createdAt, since),
        sql`exists (select 1 from ${conversations} c where c.id = ${conversationId} and c.state = 'waiting_for_analyst')`,
      ),
    );
}
