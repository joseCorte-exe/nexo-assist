import type { AgentMemory, TransferStore } from "@nexo/agent";
import type { Db } from "@/db";
import { applyMove, moves } from "./conversation-moves";

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
