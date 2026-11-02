import { caseNotes } from "@nexo/agent";
import { caseAtLimit, type LastMessage, limitSummary, MESSAGE_LIMIT, pendingAtLimit, routeTransfer, type Ticket } from "@nexo/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { conversations, drafts, messages } from "@/db/schema";
import { applyMove, type LimitPlan, moves } from "./conversation-moves";
import type { Deps } from "./deps";

// The limit of 30 messages (ARQUITETURA.md, sections 1 and 8), applied by the code right after the message that reaches
// it is answered, or saved for an analyst. What is pending, the level and the summary come from code and from what was
// saved; the model decides nothing here. The move itself, its note and its race are in conversation-moves.ts.

type LimitDeps = Pick<Deps, "db" | "memory" | "ticketService" | "directory" | "now">;
type Row = typeof conversations.$inferSelect;

export type LimitResult = { applied: false } | { applied: true; then: "closed" | "transferred" | "analyst" };

const THEN = { close: "closed", transfer: "transferred", analyst: "analyst" } as const;

/** A plan that keeps meeting another move gives up after this many reads. */
const MAX_PLANS = 3;

/**
 * Everything the plan needs, in one round trip: the row, the draft waiting for her, the last message of the two of them,
 * when she last wrote, and the newest message, which the note goes after.
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
const due = (row: Row | undefined): row is Row =>
  row !== undefined && row.state !== "closed" && row.limitReachedAt === null && row.messageCount >= MESSAGE_LIMIT;

/**
 * What the limit does with the conversation as read: an analyst keeps what they have; the agent's closes, or goes to
 * the level of its case when something is pending, with the ticket the service confirms is hers.
 */
async function planFor(deps: LimitDeps, { row, draft, lastMessage, herLastAt }: Awaited<ReturnType<typeof readCase>> & { row: Row }) {
  if (row.state === "with_analyst") {
    const name = row.analystId ? ((await deps.directory.analysts())?.get(row.analystId)?.name ?? null) : null;
    return { kind: "analyst", analyst: row.analystId ? { id: row.analystId, name } : null, level: null } satisfies LimitPlan;
  }
  if (row.state === "waiting_for_analyst") return { kind: "analyst", analyst: null, level: row.targetLevel } satisfies LimitPlan;

  const pending = pendingAtLimit({ pendingDraft: draft !== null, lastMessage });
  if (!pending) return { kind: "close" } satisfies LimitPlan;

  const at = deps.now();
  const limitCase = caseAtLimit({ draft, lastReply: lastMessage?.author === "agent" ? lastMessage.parts : [] });
  const [ticket, notes] = await Promise.all([
    limitCase.ticketId ? ticketOf(deps, limitCase.ticketId, row.employeeId) : null,
    caseNotes(deps.memory, { conversationId: row.id, employeeId: row.employeeId }),
  ]);
  const route = routeTransfer({
    requested: "message_limit",
    ticket: ticket && { priority: ticket.priority, status: ticket.status, dueAt: new Date(ticket.dueAt) },
    classification: limitCase.classification,
    at,
  });
  return {
    kind: "transfer",
    fields: {
      level: route.level,
      reason: route.reason,
      summary: limitSummary({ pending, draftTitle: draft?.title ?? null, caseNotes: notes }),
      ticketId: ticket?.id ?? null,
      waitUntil: route.waitUntil,
      // Her messages from the last one on are unread for the analyst.
      since: herLastAt === null ? at : new Date(herLastAt),
    },
  } satisfies LimitPlan;
}

/** Her ticket as the service has it now; a service down leaves the case without it rather than holding her back. */
async function ticketOf(deps: LimitDeps, ticketId: string, employeeId: string): Promise<Ticket | null> {
  const result = await deps.ticketService.getTicket(ticketId, employeeId);
  return result.ok ? result.data : null;
}

/**
 * Applies the limit to the conversation once it reached 30 messages of hers: closes it, transfers it or notes that the
 * analyst stays, with one note. Applied already, ended, or under the limit, it does nothing. A plan that another move
 * overtook (an analyst assumed meanwhile) is made again on the row as it is.
 */
export async function applyLimit(deps: LimitDeps, conversationId: string): Promise<LimitResult> {
  for (let attempt = 0; attempt < MAX_PLANS; attempt++) {
    const read = await readCase(deps.db, conversationId);
    if (!due(read.row)) return { applied: false };
    const plan = await planFor(deps, { ...read, row: read.row });
    const result = await applyMove(deps, conversationId, moves.reachLimit(plan, read.lastMessageAt), deps.now(), read.row);
    if (!result.ok) {
      if (result.refused === "changed" || result.refused === "busy") continue;
      return { applied: false };
    }
    if (!result.noteId) return { applied: false };
    if (plan.kind === "transfer") await markTicket(deps, result.row, plan.fields, result.noteId);
    return { applied: true, then: THEN[plan.kind] };
  }
  return { applied: false };
}

/** The ticket keeps the line of the transfer, keyed by the note, as the agent's transfer does. */
async function markTicket(
  deps: LimitDeps,
  row: Row,
  { level, summary, ticketId }: Extract<LimitPlan, { kind: "transfer" }>["fields"],
  noteId: string,
) {
  if (!ticketId) return;
  const marked = await deps.ticketService.transferTicket(ticketId, { employeeId: row.employeeId, level, summary }, noteId);
  if (!marked.ok) console.error("limit transfer not noted on the ticket", { ticketId, error: marked.error.code });
}
