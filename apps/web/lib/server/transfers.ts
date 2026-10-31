import { randomUUID } from "node:crypto";
import type { TransferStore } from "@nexo/agent";
import { type ChatNote, LEVEL_LABEL, type NexoUIMessage } from "@nexo/shared";
import { and, eq, sql } from "drizzle-orm";
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
      const parts = notePart({ event: "transferred", level, analystName: null, at: at.toISOString() });
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
        db.run(sql`
          insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
          select ${noteId}, ${conversationId}, 'system', null, 'transferred', ${`Transferida para o ${LEVEL_LABEL[level]}.`},
            ${JSON.stringify(parts)}, ${at.getTime()}
          where changes() = 1`),
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
