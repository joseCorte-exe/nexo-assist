import { caseNotes, noteTransferOnTicket } from "@nexo/agent";
import {
  caseAtLimit,
  type LastMessage,
  LEVEL_LABEL,
  limitSummary,
  MESSAGE_LIMIT,
  type NoteView,
  pendingAtLimit,
  reachedLimit,
  routeTransfer,
  type Ticket,
} from "@nexo/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { conversations, drafts, messages } from "@/db/schema";
import { applyMove, type Move, moves, type TransferFields } from "./conversation-moves";
import type { Deps } from "./deps";

// The limit of 30 messages (ARQUITETURA.md, sections 1 and 8), applied by the code right after the message that reaches
// it is answered, or saved for an analyst. What is pending, the level and the summary come from code and from what was
// saved; the model decides nothing here. It is a move like any other, over the version it read: a row that changed since
// is read and decided again.

type LimitDeps = Pick<Deps, "db" | "memory" | "ticketService" | "directory" | "now">;
type Row = typeof conversations.$inferSelect;

/** What the limit does with the conversation; transfer, when it goes to an analyst, for the line on its ticket. */
type Outcome = Pick<Move<"changed">, "set" | "note"> & { transfer?: TransferFields };

/** Another move that keeps overtaking the limit makes it give up after this many reads. */
const MAX_READS = 3;

/**
 * Everything the outcome needs, in one round trip: the row, the draft waiting for her, the last message of the two of
 * them, when she last wrote, and the newest message, which the note goes after.
 */
async function readCase(db: Deps["db"], conversationId: string) {
  const [[row], [draft], [last], [mine], [newest]] = await db.batch([
    db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1),
    db
      .select()
      .from(drafts)
      .where(and(eq(drafts.conversationId, conversationId), inArray(drafts.status, ["pending", "confirming"])))
      .orderBy(desc(drafts.createdAt))
      .limit(1),
    db
      .select({ author: messages.author, parts: messages.parts })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), inArray(messages.author, ["employee", "agent"])))
      .orderBy(desc(messages.createdAt))
      .limit(1),
    db
      .select({ at: sql<number | null>`max(${messages.createdAt})` })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.author, "employee"))),
    db.select({ at: sql<number | null>`max(${messages.createdAt})` }).from(messages).where(eq(messages.conversationId, conversationId)),
  ]);
  const lastMessage: LastMessage = last ? { author: last.author as "employee" | "agent", parts: last.parts ?? [] } : null;
  const lastMessageAt = newest?.at == null ? null : new Date(newest.at);
  return { row, draft: draft ?? null, lastMessage, herLastAt: mine?.at ?? null, lastMessageAt };
}

/** Whether the limit is still to be applied to this row. */
const due = (row: Row | undefined): row is Row => row !== undefined && row.state !== "closed" && row.limitReachedAt === null && reachedLimit(row.messageCount);

/** The note of the limit: what the console and the chat draw, and what the agent reads. */
const limitNote = (limit: Extract<NoteView, { event: "limit_reached" }>["limit"], ending: string): Outcome["note"] => ({
  authorId: null,
  note: { event: "limit_reached", limit },
  text: `A conversa chegou ao limite de ${MESSAGE_LIMIT} mensagens e ${ending}`,
  memory: true,
});

/** An analyst has her, or she waits for a level: nothing moves, the limit is only marked. */
const stays = (note: Outcome["note"]): Outcome => ({ set: (at) => ({ limitReachedAt: at }), note });

const closes: Outcome = {
  set: (at) => ({ state: "closed", outcome: "limit_reached", closedAt: at, limitReachedAt: at }),
  note: limitNote({ then: "closed" }, "foi encerrada."),
};

const transfers = (fields: TransferFields): Outcome => ({
  set: (at) => ({ ...moves.transfer(fields).set(at), limitReachedAt: at }),
  note: limitNote({ then: "transferred", level: fields.level }, `foi transferida para o ${LEVEL_LABEL[fields.level]}.`),
  transfer: fields,
});

/**
 * What the limit does with the conversation as read: an analyst keeps what they have; the agent's closes, or goes to the
 * level of its case when something is pending, with the ticket the service confirms is hers.
 */
async function outcomeOf(deps: LimitDeps, { row, draft, lastMessage, herLastAt }: Awaited<ReturnType<typeof readCase>> & { row: Row }): Promise<Outcome> {
  if (row.state === "with_analyst") {
    const name = row.analystId ? ((await deps.directory.analysts())?.get(row.analystId)?.name ?? null) : null;
    return stays(limitNote({ then: "with_analyst", analystName: name }, `continua com ${name ?? "o analista"}.`));
  }
  if (row.state === "waiting_for_analyst") {
    // Only a transfer makes a conversation wait, and it always says for which level.
    const level = row.targetLevel ?? "N1";
    return stays(limitNote({ then: "waiting", level }, `espera o ${LEVEL_LABEL[level]}.`));
  }

  const pending = pendingAtLimit({ pendingDraft: draft !== null, lastMessage });
  if (!pending) return closes;

  const at = deps.now();
  const limitCase = caseAtLimit({ draft, lastReply: lastMessage?.author === "agent" ? lastMessage.parts : [] });
  const [ticket, caseLines] = await Promise.all([
    limitCase.ticketId ? ticketOf(deps, limitCase.ticketId, row.employeeId) : null,
    caseNotes(deps.memory, { conversationId: row.id, employeeId: row.employeeId }),
  ]);
  const route = routeTransfer({ requested: "message_limit", ticket, classification: limitCase.classification, at });
  return transfers({
    level: route.level,
    reason: route.reason,
    summary: limitSummary({ pending, draftTitle: draft?.title ?? null, caseLines }),
    ticketId: ticket?.id ?? null,
    waitUntil: route.waitUntil,
    confidence: null,
    // Her messages from the last one on are unread for the analyst.
    turnStartedAt: herLastAt === null ? at : new Date(herLastAt),
  });
}

/** Her ticket as the service has it now; a service down leaves the case without it rather than holding her back. */
async function ticketOf(deps: LimitDeps, ticketId: string, employeeId: string): Promise<Ticket | null> {
  const result = await deps.ticketService.getTicket(ticketId, employeeId);
  return result.ok ? result.data : null;
}

/**
 * Applies the limit to the conversation once it reached 30 messages of hers: closes it, transfers it or notes that the
 * analyst stays, with one note. Applied already, ended, or under the limit, it does nothing. Another move that overtook
 * it (an analyst assumed meanwhile) changed the version: the case is read and decided again.
 */
export async function applyLimit(deps: LimitDeps, conversationId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_READS; attempt++) {
    const read = await readCase(deps.db, conversationId);
    const { row, lastMessageAt } = read;
    if (!due(row)) return;
    const { transfer, ...outcome } = await outcomeOf(deps, { ...read, row });
    const move: Move<"changed"> = {
      ...outcome,
      decide: (current) => (current.version === row.version ? "apply" : { refused: "changed" }),
      // After the newest message, even the reply saved in the same millisecond.
      notePlace: (at) => (lastMessageAt && lastMessageAt.getTime() >= at.getTime() ? new Date(lastMessageAt.getTime() + 1) : at),
    };
    const result = await applyMove(deps, conversationId, move, deps.now());
    if (!result.ok) continue;
    if (transfer?.ticketId && result.noteId) {
      await noteTransferOnTicket(deps.ticketService, transfer.ticketId, { employeeId: row.employeeId, level: transfer.level, summary: transfer.summary }, result.noteId);
    }
    return;
  }
}
