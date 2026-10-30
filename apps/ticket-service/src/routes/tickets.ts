import { randomUUID } from "node:crypto";
import {
  canReopen,
  createTicketInput,
  dueAt,
  IDEMPOTENCY_KEY_HEADER,
  type Ticket,
  type TicketDetail,
  type TicketType,
  ticketFollowUpInput,
  ticketId,
} from "@nexo/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import type { Db } from "../db";
import { analysts, employees, idempotencyKeys, tickets, ticketUpdates } from "../db/schema";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const detailParams = z.object({ id: ticketId, employeeId: z.string().min(1) });

/** A rule refused the write inside its transaction: nothing is written, and the request gets this answer. */
class Refusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Somebody else's ticket answers exactly like a missing one, so the error never tells that a number exists.
const ticketNotFound = () => new Refusal(404, "ticket_not_found", "Ticket not found");

export function ticketRoutes(deps: Deps) {
  return new Hono()
    .get("/:id", async (c) => {
      const parsed = detailParams.safeParse({ id: c.req.param("id"), employeeId: c.req.query("employeeId") });
      if (!parsed.success) return c.json(errorBody("invalid_query", "a ticket number and employeeId are required"), 400);
      const detail = await ticketDetail(deps.db, parsed.data.id, parsed.data.employeeId);
      return detail ? c.json(detail) : c.json(errorBody("ticket_not_found", "Ticket not found"), 404);
    })
    .post("/", async (c) => {
      const body = await parseWrite(c, createTicketInput);
      if (!body.ok) return body.response;
      const input = body.data;
      return idempotent(deps, c, { key: body.key, scope: "POST /tickets", status: 201 }, async (tx, now) => {
        const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
        if (!employee) throw new Refusal(400, "unknown_employee", "Employee not found");
        const [row] = await tx
          .insert(tickets)
          .values({
            id: await nextTicketId(tx, input.type),
            type: input.type,
            title: input.title,
            description: input.description,
            category: input.category,
            subcategory: input.subcategory,
            priority: input.priority,
            affected: input.affected,
            status: "waiting_for_analyst",
            openedBy: input.employeeId,
            assignedTo: null,
            createdAt: now,
            updatedAt: now,
            lastItResponseAt: null,
            dueAt: dueAt({ priority: input.priority, createdAt: now, lastItResponseAt: null }),
            resolvedAt: null,
          })
          .returning();
        if (!row) throw new Error("Insert returned no row");
        return toTicket(row);
      });
    })
    // A follow-up of the employee on an open ticket of hers. It is an update of the employee: it restarts neither the
    // deadline nor the last update, which count the answers of IT (RN-02).
    .patch("/:id", async (c) => {
      const id = ticketId.safeParse(c.req.param("id"));
      if (!id.success) return c.json(errorBody("invalid_ticket", "Invalid ticket number"), 400);
      const body = await parseWrite(c, ticketFollowUpInput);
      if (!body.ok) return body.response;
      const { employeeId, text } = body.data;
      return idempotent(deps, c, { key: body.key, scope: `PATCH /tickets/${id.data}`, status: 200 }, async (tx, now) => {
        const ticket = await ticketOf(tx, id.data, employeeId);
        if (ticket.status === "resolved") throw new Refusal(409, "ticket_resolved", "The ticket is resolved");
        await addUpdate(tx, { ticketId: ticket.id, text, now });
        return toTicket(ticket);
      });
    })
    // Reopens a ticket of hers resolved up to 7 calendar days ago. The reopening counts as a new opening: waiting for an
    // analyst again, nobody assigned, and the deadline counted from now.
    .post("/:id/reopen", async (c) => {
      const id = ticketId.safeParse(c.req.param("id"));
      if (!id.success) return c.json(errorBody("invalid_ticket", "Invalid ticket number"), 400);
      const body = await parseWrite(c, ticketFollowUpInput);
      if (!body.ok) return body.response;
      const { employeeId, text } = body.data;
      const scope = `POST /tickets/${id.data}/reopen`;
      return idempotent(deps, c, { key: body.key, scope, status: 200 }, async (tx, now) => {
        const ticket = await ticketOf(tx, id.data, employeeId);
        if (ticket.status !== "resolved" || !ticket.resolvedAt) {
          throw new Refusal(409, "ticket_not_resolved", "The ticket is not resolved");
        }
        if (!canReopen(ticket.resolvedAt, now)) {
          throw new Refusal(409, "reopen_window_closed", "The ticket was resolved more than 7 days ago");
        }
        const [row] = await tx
          .update(tickets)
          .set({
            status: "waiting_for_analyst",
            assignedTo: null,
            resolvedAt: null,
            updatedAt: now,
            dueAt: dueAt({ priority: ticket.priority, createdAt: now, lastItResponseAt: null }),
          })
          .where(eq(tickets.id, ticket.id))
          .returning();
        if (!row) throw new Error("Update returned no row");
        await addUpdate(tx, { ticketId: ticket.id, text, now });
        return toTicket(row);
      });
    });
}

/** The idempotency key and the body of a write, or the 400 to answer. The key comes first: no write goes without it. */
async function parseWrite<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<{ ok: true; key: string; data: T } | { ok: false; response: Response }> {
  const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
  if (!key) {
    return { ok: false, response: c.json(errorBody("missing_idempotency_key", `${IDEMPOTENCY_KEY_HEADER} header is required`), 400) };
  }
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return { ok: false, response: c.json(errorBody("invalid_body", parsed.error.message), 400) };
  return { ok: true, key, data: parsed.data };
}

/**
 * Runs a write once per idempotency key. The answer is saved with the key in the write's own transaction, so a retry
 * (the client's, after an outage that fell after writing) gets what was written, and two requests at once do it once.
 * A key reused for another request is refused rather than answered with a ticket that is not the one asked for.
 */
async function idempotent(
  deps: Deps,
  c: Context,
  { key, scope, status }: { key: string; scope: string; status: ContentfulStatusCode },
  write: (tx: Transaction, now: Date) => Promise<Ticket>,
) {
  const replay = (saved: { scope: string; response: Ticket }) =>
    saved.scope === scope
      ? c.json(saved.response, status)
      : c.json(errorBody("idempotency_key_reused", "The key was used for another request"), 422);

  const saved = await savedResponse(deps.db, key);
  if (saved) return replay(saved);
  try {
    const ticket = await deps.db.transaction(async (tx) => {
      const now = deps.now();
      const response = await write(tx, now);
      await tx.insert(idempotencyKeys).values({ key, scope, response, createdAt: now });
      return response;
    });
    return c.json(ticket, status);
  } catch (error) {
    if (error instanceof Refusal) return c.json(errorBody(error.code, error.message), error.status);
    // Two requests with the same key at once: the second loses on the key and answers what the first one wrote.
    const raced = await savedResponse(deps.db, key);
    if (raced) return replay(raced);
    throw error;
  }
}

/** The ticket, if it is this employee's: inside the transaction, so its state cannot change before the write. */
async function ticketOf(tx: Transaction, id: string, employeeId: string) {
  const [ticket] = await tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), eq(tickets.openedBy, employeeId)));
  if (!ticket) throw ticketNotFound();
  return ticket;
}

function addUpdate(tx: Transaction, { ticketId: id, text, now }: { ticketId: string; text: string; now: Date }) {
  return tx.insert(ticketUpdates).values({ id: `upd-${randomUUID()}`, ticketId: id, author: "employee", text, createdAt: now });
}

/**
 * The ticket of this employee with the analyst's name and the updates, in one round trip. Both queries are scoped to
 * the employee, so the updates of somebody else's ticket never leave the database either.
 */
async function ticketDetail(db: Db, id: string, employeeId: string): Promise<TicketDetail | null> {
  const ofEmployee = and(eq(tickets.id, id), eq(tickets.openedBy, employeeId));
  const [[found], updates] = await db.batch([
    db
      .select({ ticket: tickets, assigneeName: analysts.name })
      .from(tickets)
      .leftJoin(analysts, eq(analysts.id, tickets.assignedTo))
      .where(ofEmployee),
    db
      .select({ author: ticketUpdates.author, text: ticketUpdates.text, createdAt: ticketUpdates.createdAt })
      .from(ticketUpdates)
      .innerJoin(tickets, eq(tickets.id, ticketUpdates.ticketId))
      .where(ofEmployee)
      .orderBy(asc(ticketUpdates.createdAt)),
  ]);
  if (!found) return null;
  return {
    ...toTicket(found.ticket),
    assigneeName: found.assigneeName,
    updates: updates.map((update) => ({ ...update, createdAt: update.createdAt.toISOString() })),
  };
}

async function savedResponse(db: Db, key: string) {
  const [saved] = await db
    .select({ scope: idempotencyKeys.scope, response: idempotencyKeys.response })
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, key));
  return saved ? { scope: saved.scope, response: saved.response as Ticket } : null;
}

async function nextTicketId(tx: Transaction, type: TicketType) {
  const [result] = await tx
    .select({ max: sql<number | null>`max(cast(substr(${tickets.id}, 5) as integer))` })
    .from(tickets)
    .where(eq(tickets.type, type));
  const start = type === "INC" ? 20000 : 10000;
  return `${type}-${(result?.max ?? start) + 1}`;
}

export function toTicket(row: typeof tickets.$inferSelect): Ticket {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastItResponseAt: row.lastItResponseAt?.toISOString() ?? null,
    dueAt: row.dueAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
