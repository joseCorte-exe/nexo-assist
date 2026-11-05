import type { AgentMemory, TransferStore } from "@nexo/agent";
import { criticalDraft, decisionOf, fitSummary, type NexoUIMessage, routeTransfer } from "@nexo/shared";
import type { Db } from "@/db";
import { applyMove, moves, type TransferFields } from "./conversation-moves";

/**
 * The transfers of the agent, in the conversations database (ARQUITETURA.md, section 6): the transfer move, while the
 * conversation is still with the agent. An analyst may have assumed it while the agent was answering: then the reply
 * is saved but its transfer does not happen.
 */
export function createTransferStore(deps: { db: Db; memory: Pick<AgentMemory, "saveMessages"> }): TransferStore {
  return {
    transfer: async ({ conversationId, at, ...fields }) => {
      const result = await applyMove(deps, conversationId, moves.transfer(fields), at);
      return result.ok && result.noteId ? { transferred: true, noteId: result.noteId } : { transferred: false };
    },
  };
}

/**
 * A new ticket RN-01 read as critical goes to an analyst (PRD, Anexo A), and the code does it: what the transfer sets, for
 * the batch that saves the reply announcing it, so a failure leaves neither and the retry does both. The description is
 * the summary, since it was written for the analyst not to ask again. The card stays: she can still confirm it.
 */
export function criticalTransfer(reply: NexoUIMessage, turnStartedAt: Date): TransferFields | null {
  const draft = criticalDraft(reply.parts);
  if (!draft) return null;
  // The draft is what the ticket will be. Counted from it, the wait is the one the reply told her.
  const route = routeTransfer({ requested: "employee_request", ticket: { ...draft, status: "waiting_for_analyst" }, classification: null, at: new Date(draft.createdAt) });
  return {
    level: route.level,
    reason: route.reason,
    summary: fitSummary(`${draft.title}. ${draft.description}`),
    ticketId: null,
    waitUntil: route.waitUntil,
    confidence: decisionOf(reply.parts)?.confidence ?? null,
    turnStartedAt,
  };
}
