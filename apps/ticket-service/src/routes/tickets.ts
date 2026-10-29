import {
  createTicketInput,
  dueAt,
  IDEMPOTENCY_KEY_HEADER,
  type Ticket,
  type TicketDetail,
  type TicketType,
  ticketId,
} from "@nexo/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import type { Db } from "../db";
import { analysts, employees, idempotencyKeys, tickets, ticketUpdates } from "../db/schema";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const detailParams = z.object({ id: ticketId, employeeId: z.string().min(1) });

export function ticketRoutes(deps: Deps) {
  return new Hono()
    .get("/:id", async (c) => {
      const parsed = detailParams.safeParse({ id: c.req.param("id"), employeeId: c.req.query("employeeId") });
      if (!parsed.success) return c.json(errorBody("invalid_query", "a ticket number and employeeId are required"), 400);
      const detail = await ticketDetail(deps.db, parsed.data.id, parsed.data.employeeId);
      // Somebody else's ticket answers exactly like a missing one, so the error never tells that a number exists.
      return detail ? c.json(detail) : c.json(errorBody("ticket_not_found", "Ticket not found"), 404);
    })
    .post("/", async (c) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (!key) return c.json(errorBody("missing_idempotency_key", `${IDEMPOTENCY_KEY_HEADER} header is required`), 400);

    const parsed = createTicketInput.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json(errorBody("invalid_body", parsed.error.message), 400);
    const input = parsed.data;

    const saved = await savedResponse(deps.db, key);
    if (saved) return c.json(saved, 201);

    const [employee] = await deps.db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId));
    if (!employee) return c.json(errorBody("unknown_employee", "Employee not found"), 400);

    try {
      const ticket = await deps.db.transaction(async (tx) => {
        const now = deps.now();
        const id = await nextTicketId(tx, input.type);
        const [row] = await tx
          .insert(tickets)
          .values({
            id,
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
        const response = toTicket(row);
        await tx.insert(idempotencyKeys).values({ key, response, createdAt: now });
        return response;
      });
      return c.json(ticket, 201);
    } catch (error) {
      // Two requests with the same key at once: the second loses on the key and returns the first one's ticket.
      const raced = await savedResponse(deps.db, key);
      if (raced) return c.json(raced, 201);
      throw error;
    }
  });
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
  const [saved] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
  return saved ? (saved.response as Ticket) : null;
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
