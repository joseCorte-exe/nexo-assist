import type { AgentMemory, ResolutionStore } from "@nexo/agent";
import { closedAsResolved, type NexoUIMessage, WAITING_DRAFT } from "@nexo/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, drafts, messages } from "@/db/schema";
import { applyMove, moves } from "./conversation-moves";

/**
 * The conversations the agent ends as solved, in the conversations database (ARQUITETURA.md, section 6): the resolve
 * move, unless a draft still waits for her. An analyst may have assumed it while the agent was answering: then the
 * reply is saved but the conversation stays with the analyst.
 */
export function createResolutionStore(deps: { db: Db; memory: Pick<AgentMemory, "saveMessages"> }): ResolutionStore {
  return {
    resolve: async ({ conversationId, turnStartedAt, at }) => {
      const [waiting] = await deps.db
        .select({ id: drafts.id })
        .from(drafts)
        .where(and(eq(drafts.conversationId, conversationId), inArray(drafts.status, WAITING_DRAFT)))
        .limit(1);
      if (waiting) return { resolved: false, reason: "draft_pending" };
      const result = await applyMove(deps, conversationId, moves.resolve(turnStartedAt), at);
      return result.ok ? { resolved: true } : { resolved: false, reason: "not_with_agent" };
    },
  };
}

/**
 * A reply that failed is not saved, and "Tentar de novo" asks for it again: a conversation it ended goes back to the
 * agent, without its note, or the message could not be answered and the number would count a reply nobody read. She may
 * have opened another conversation meanwhile, which the one open per employee refuses: this one then stays closed.
 */
export async function undoResolution(db: Db, conversationId: string, reply: NexoUIMessage) {
  if (!closedAsResolved(reply.parts)) return;
  try {
    await db.batch([
      db
        .update(conversations)
        .set({ state: "with_agent", outcome: null, closedAt: null, version: sql`${conversations.version} + 1` })
        .where(and(eq(conversations.id, conversationId), eq(conversations.outcome, "resolved_by_agent"))),
      db.delete(messages).where(and(eq(messages.conversationId, conversationId), eq(messages.event, "resolved"))),
    ]);
  } catch (error) {
    console.error("resolution of a failed reply not undone", { conversationId, error: (error as Error).name });
  }
}
