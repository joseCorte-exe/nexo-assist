import type { ResolutionStore } from "@nexo/agent";
import { markedResolved, type NexoUIMessage } from "@nexo/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, drafts } from "@/db/schema";
import { applyMove, moves } from "./conversation-moves";
import type { Deps } from "./deps";
import { WAITING_DRAFT } from "./drafts";

// The conversations the agent ends as solved (ARQUITETURA.md, section 6). The tool only asks whether it can end; the
// route closes it right after saving the reply, as the limit does, so a reply that failed closes nothing.

/** Why the conversation cannot end as solved now: an analyst has it, or a draft still waits for her. Null if it can. */
async function refusalOf(db: Db, conversationId: string) {
  const [[row], [waiting]] = await db.batch([
    db.select({ state: conversations.state }).from(conversations).where(eq(conversations.id, conversationId)).limit(1),
    db
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(eq(drafts.conversationId, conversationId), inArray(drafts.status, WAITING_DRAFT)))
      .limit(1),
  ]);
  if (row?.state !== "with_agent") return "not_with_agent" as const;
  return waiting ? ("draft_pending" as const) : null;
}

export const createResolutionStore = (db: Db): ResolutionStore => ({ check: (conversationId) => refusalOf(db, conversationId) });

/**
 * Closes the conversation of a saved reply that said it was solved, checking again what may have changed since the tool
 * answered. A draft shown in the same reply keeps it open, with its card live; an analyst who assumed meanwhile keeps it.
 */
export async function closeIfResolved(
  deps: Pick<Deps, "db" | "memory" | "now">,
  { conversationId, turnStartedAt, reply }: { conversationId: string; turnStartedAt: Date; reply: NexoUIMessage },
) {
  if (!markedResolved(reply.parts)) return;
  const refusal = await refusalOf(deps.db, conversationId);
  const result = refusal ? null : await applyMove(deps, conversationId, moves.resolve(turnStartedAt), deps.now());
  if (result?.ok) return;
  console.error("reply said solved but the conversation stays open", { conversationId, reason: refusal ?? result?.refused });
}
