import { createTicketInput, dueAt, IDEMPOTENCY_KEY_HEADER, type Ticket, type TicketType } from "@nexo/shared";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import type { Db } from "../db";
import { employees, idempotencyKeys, tickets } from "../db/schema";

type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function ticketRoutes(deps: Deps) {
  return new Hono().post("/", async (c) => {
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
