import { randomUUID } from "node:crypto";
import { type DraftStore, saveNote } from "@nexo/agent";
import {
  CATEGORY_LABEL,
  type DraftRejection,
  type DraftView,
  deadlineWords,
  draftLabel,
  draftRejection,
  editDraftInput,
  PRIORITY_LABEL,
  slaText,
  type Ticket,
  type TicketServiceResult,
} from "@nexo/shared";
import { and, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import type { Db } from "@/db";
import { conversations, drafts, messages } from "@/db/schema";
import type { Deps } from "./deps";
import { jsonError, readBody, readEmployeeSession, serviceUnavailable } from "./http";

// The draft of a ticket after the agent showed it (ARQUITETURA.md, sections 7 and 8). The employee edits, confirms or
// cancels it in the card, and the code does it without the model. What she did is noted in the conversation and in the
// agent memory, so the agent knows it next turn.

type DraftRow = typeof drafts.$inferSelect;

/** The first draft is D-381, the number nexo.pen shows. */
const NUMBER_BEFORE_FIRST = 380;

export function toDraftView(row: DraftRow): DraftView {
  return {
    id: row.id,
    number: row.number,
    operation: row.operation,
    status: row.status,
    ticketId: row.ticketId,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    priority: row.priority,
    affected: row.affected,
    rejectedReason: row.rejectedReason,
    deadline: slaText(row.priority),
    dueAt: row.dueAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The drafts of the agent, in the conversations database. Saving a draft supersedes the one waiting in the same
 * conversation and numbers the new one, in one batch: a single round trip that SQLite runs as one transaction.
 */
export function createDraftStore(db: Db): DraftStore {
  return {
    save: async ({ conversationId, ...draft }) => {
      const [, [row]] = await db.batch([
        db
          .update(drafts)
          .set({ status: "superseded" })
          .where(and(eq(drafts.conversationId, conversationId), eq(drafts.status, "pending"))),
        db
          .insert(drafts)
          .values({
            ...draft,
            id: `draft-${randomUUID()}`,
            number: sql`(select coalesce(max(${drafts.number}), ${NUMBER_BEFORE_FIRST}) + 1 from ${drafts})`,
            conversationId,
            status: "pending",
            rejectedReason: null,
          })
          .returning(),
      ]);
      if (!row) throw new Error("The draft was not saved");
      return toDraftView(row);
    },
  };
}

/**
 * The draft, if it belongs to a conversation of this employee. Somebody else's draft is not found, the same as one
 * that does not exist.
 */
async function draftOf(db: Db, id: string, employeeId: string) {
  const [found] = await db
    .select({ draft: drafts, conversationState: conversations.state })
    .from(drafts)
    .innerJoin(conversations, eq(conversations.id, drafts.conversationId))
    .where(and(eq(drafts.id, id), eq(conversations.employeeId, employeeId)))
    .limit(1);
  return found ?? null;
}

const draftNotFound = () => jsonError(404, "draft_not_found", "Rascunho não encontrado.");
const draftNotPending = () => jsonError(409, "draft_not_pending", "Este rascunho não vale mais. Confira o mais recente.");
const viewOf = (row: DraftRow) => NextResponse.json<DraftView>(toDraftView(row));

/** What the draft is, in the words of a note: "o rascunho D-381", "o complemento do INC-20311". */
function nameOf(draft: DraftRow) {
  if (draft.operation === "update") return `o complemento do ${draft.ticketId}`;
  if (draft.operation === "reopen") return `a reabertura do ${draft.ticketId}`;
  return `o rascunho ${draftLabel(draft.number)}`;
}

const REJECTED_BECAUSE: Record<DraftRejection, string> = {
  ticket_not_found: "não encontrei o chamado entre os seus",
  ticket_resolved: "ele foi resolvido e não recebe mais complementos",
  ticket_not_resolved: "ele não está resolvido",
  reopen_window_closed: "ele foi resolvido há mais de 7 dias e não pode mais ser reaberto",
};

/**
 * Moves a pending draft to its next state, and only then notes it: in the conversation, in the same batch, and in the
 * agent memory after. A draft that left pending meanwhile (two clicks, two tabs) is answered as it is, noted once.
 */
async function settle(
  deps: Deps,
  { draft, employeeId, event, set, note }: { draft: DraftRow; employeeId: string; event: string; set: Partial<DraftRow>; note: string },
) {
  const [row] = await deps.db
    .update(drafts)
    .set(set)
    .where(and(eq(drafts.id, draft.id), eq(drafts.status, "pending")))
    .returning();
  if (!row) {
    const [current] = await deps.db.select().from(drafts).where(eq(drafts.id, draft.id));
    return current ?? draft;
  }

  const id = `note-${draft.id}-${event}`;
  const at = deps.now();
  await deps.db
    .insert(messages)
    .values({ id, conversationId: draft.conversationId, author: "system", text: note, parts: null, createdAt: at })
    .onConflictDoNothing();
  try {
    await saveNote(deps.memory, { id, conversationId: draft.conversationId, employeeId, text: note, at });
  } catch (error) {
    // The draft and its note in the conversation are saved: a memory that did not take the note only costs context.
    console.error("note not copied to the agent memory", { draftId: draft.id, event, error: (error as Error).name });
  }
  return row;
}

/** The write of the ticket-service each operation means, with the draft as the idempotency key. */
function writeTicket(deps: Deps, draft: DraftRow, employeeId: string): Promise<TicketServiceResult<Ticket>> {
  const change = { employeeId, text: draft.description };
  if (draft.operation === "update") return deps.ticketService.addFollowUp(draft.ticketId!, change, draft.id);
  if (draft.operation === "reopen") return deps.ticketService.reopenTicket(draft.ticketId!, change, draft.id);
  return deps.ticketService.createTicket(
    {
      employeeId,
      type: draft.type,
      title: draft.title,
      description: draft.description,
      category: draft.category,
      subcategory: draft.subcategory,
      priority: draft.priority,
      affected: draft.affected,
    },
    draft.id,
  );
}

function confirmedNote(draft: DraftRow, ticket: Ticket, now: Date) {
  const due = deadlineWords(new Date(ticket.dueAt), now);
  if (draft.operation === "update") return `Confirmei o complemento do ${ticket.id}. A informação nova foi acrescentada ao chamado.`;
  if (draft.operation === "reopen") return `Confirmei a reabertura do ${ticket.id}. Ele voltou para Aguardando analista, com resposta ${due}.`;
  const priority = PRIORITY_LABEL[ticket.priority].toLowerCase();
  return `Confirmei o rascunho ${draftLabel(draft.number)}. O chamado ${ticket.id} foi criado, com prioridade ${priority} e resposta ${due}.`;
}

/**
 * POST /api/drafts/:id/confirm. Creates, follows up or reopens the ticket in the ticket-service, without the model.
 * Confirming again answers what the first one did. If the service does not answer, the draft stays pending, and
 * confirming again cannot duplicate anything: the key of the write is the draft. If the service refuses (the ticket
 * changed since the draft), the refusal is kept on the draft.
 */
export async function confirmDraftHandler(request: NextRequest, deps: Deps, id: string) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const employeeId = session.session.id;
  const found = await draftOf(deps.db, id, employeeId);
  if (!found) return draftNotFound();
  const { draft, conversationState } = found;
  if (draft.status === "confirmed" || draft.status === "rejected") return viewOf(draft);
  if (draft.status !== "pending") return draftNotPending();
  if (conversationState === "closed") return jsonError(409, "conversation_closed", "Esta conversa foi encerrada.");

  const result = await writeTicket(deps, draft, employeeId);
  if (!result.ok) {
    const rejection = draftRejection.safeParse(result.error.serviceCode);
    if (rejection.success) {
      const note = `Tentei confirmar ${nameOf(draft)}, mas ${REJECTED_BECAUSE[rejection.data]}.`;
      return viewOf(await settle(deps, { draft, employeeId, event: "rejected", set: { status: "rejected", rejectedReason: rejection.data }, note }));
    }
    console.error("draft not confirmed", { draftId: draft.id, error: result.error.code, status: result.error.status });
    return result.error.code === "unavailable" || result.error.code === "timeout"
      ? serviceUnavailable()
      : jsonError(502, "service_error", "O serviço de chamados respondeu de um jeito inesperado. Tente de novo.");
  }

  const ticket = result.data;
  const set = { status: "confirmed" as const, ticketId: ticket.id, dueAt: new Date(ticket.dueAt) };
  const note = confirmedNote(draft, ticket, deps.now());
  return viewOf(await settle(deps, { draft, employeeId, event: "confirmed", set, note }));
}

/** POST /api/drafts/:id/cancel. Discards a pending draft; asked again, answers the same. */
export async function cancelDraftHandler(request: NextRequest, deps: Deps, id: string) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const employeeId = session.session.id;
  const found = await draftOf(deps.db, id, employeeId);
  if (!found) return draftNotFound();
  const { draft } = found;
  if (draft.status === "confirmed") return jsonError(409, "draft_confirmed", "Este chamado já foi criado.");
  if (draft.status !== "pending") return viewOf(draft);
  const note = `Descartei o rascunho ${draftLabel(draft.number)}. Nada foi enviado.`;
  return viewOf(await settle(deps, { draft, employeeId, event: "cancelled", set: { status: "cancelled" }, note }));
}

const quote = (text: string) => `"${text.length > 200 ? `${text.slice(0, 199)}…` : text}"`;

/**
 * PATCH /api/drafts/:id. The title, the description and the category of a new ticket; only the text of a follow-up or
 * a reopening, whose ticket keeps its own. Never the priority, which comes from RN-01.
 */
export async function editDraftHandler(request: NextRequest, deps: Deps, id: string) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const body = await readBody(request, editDraftInput);
  if (!body.ok) return body.response;
  const employeeId = session.session.id;
  const found = await draftOf(deps.db, id, employeeId);
  if (!found) return draftNotFound();
  const { draft } = found;
  if (draft.status !== "pending") return jsonError(409, "draft_not_pending", "Este rascunho não pode mais ser editado.");
  const { title, description, category } = body.data;
  if (draft.operation !== "create" && (title !== undefined || category !== undefined)) {
    return jsonError(422, "field_not_editable", "Num complemento ou reabertura, só o texto pode ser editado.");
  }

  const set: Partial<DraftRow> = {};
  const said: string[] = [];
  if (title !== undefined && title !== draft.title) {
    set.title = title;
    said.push(`título ${quote(title)}`);
  }
  if (description !== undefined && description !== draft.description) {
    set.description = description;
    said.push(`descrição ${quote(description)}`);
  }
  if (category !== undefined && category !== draft.category) {
    // The subcategory belonged to the old category.
    Object.assign(set, { category, subcategory: null });
    said.push(`categoria ${CATEGORY_LABEL[category]}`);
  }
  if (said.length === 0) return viewOf(draft);

  const note = `Editei o rascunho ${draftLabel(draft.number)}: ${said.join(", ")}.`;
  const row = await settle(deps, { draft, employeeId, event: `edited-${randomUUID()}`, set, note });
  return row.status === "pending" ? viewOf(row) : jsonError(409, "draft_not_pending", "Este rascunho não pode mais ser editado.");
}

/** The drafts of a conversation in their current state, oldest first: what the cards of the chat draw. */
export const draftsOf = (db: Db, conversationId: string) =>
  db.select().from(drafts).where(eq(drafts.conversationId, conversationId)).orderBy(drafts.createdAt);
