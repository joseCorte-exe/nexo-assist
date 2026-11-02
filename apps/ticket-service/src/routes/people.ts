import {
  type Analyst,
  availabilityInput,
  candidatesQuery,
  corporateEmail,
  type Employee,
  employeeTicketsStatus,
  isReopenable,
  MAX_EMPLOYEE_IDS,
} from "@nexo/shared";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import { analysts, employees, tickets } from "../db/schema";
import { toTicket } from "./tickets";

/** A search by name answers at most this many: the console shows them as a filter, not as a directory. */
const MAX_SEARCH_RESULTS = 20;

/** Exactly one filter: the e-mail of the login, the ids of a page of the console, or a part of a name to search. */
const employeesQuery = z.union([
  z.strictObject({ email: corporateEmail() }),
  z.strictObject({
    ids: z
      .string()
      .transform((ids) => [...new Set(ids.split(",").filter(Boolean))])
      .pipe(z.array(z.string()).min(1).max(MAX_EMPLOYEE_IDS)),
  }),
  z.strictObject({ q: z.string().trim().min(1).max(100) }),
]);
const ticketsQuery = z.object({ status: employeeTicketsStatus.optional() });

/** The text of a search as LIKE reads it: % and _ are letters, not wildcards. */
const likeContaining = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export function employeeRoutes(deps: Deps) {
  // A filter over the collection, so it answers a list: empty when nobody matches.
  return new Hono().get("/", async (c) => {
    const parsed = employeesQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(errorBody("invalid_query", `one of email, ids (up to ${MAX_EMPLOYEE_IDS}) or q is required`), 400);
    }
    const query = parsed.data;
    // Seeded e-mails are lowercase and the column is unique, so this is an index lookup; ids are the primary key.
    const where =
      "email" in query
        ? eq(employees.email, query.email)
        : "ids" in query
          ? inArray(employees.id, query.ids)
          : sql`${employees.name} like ${likeContaining(query.q)} escape '\\'`;
    const rows = await deps.db
      .select()
      .from(employees)
      .where(where)
      .orderBy(asc(employees.name))
      .limit("q" in query ? MAX_SEARCH_RESULTS : MAX_EMPLOYEE_IDS);
    return c.json(rows.map(toEmployee));
  })
    // The tickets of the employee, most recent first. The index on (opened_by, created_at) answers it in order.
    .get("/:id/tickets", async (c) => {
      const parsed = ticketsQuery.safeParse(c.req.query());
      if (!parsed.success) return c.json(errorBody("invalid_query", "status must be open or absent"), 400);
      const employeeId = c.req.param("id");

      const mine = eq(tickets.openedBy, employeeId);
      const rows = await deps.db
        .select()
        .from(tickets)
        .where(parsed.data.status === "open" ? and(mine, ne(tickets.status, "resolved")) : mine)
        .orderBy(desc(tickets.createdAt), desc(tickets.id));
      // Only an empty answer needs to tell an employee without tickets from one that does not exist.
      if (rows.length === 0 && !(await employeeExists(deps, employeeId))) {
        return c.json(errorBody("employee_not_found", "Employee not found"), 404);
      }
      return c.json(rows.map(toTicket));
    })
    // The tickets of the employee in a category that a new ticket could duplicate (Annex A): the open ones, which get
    // the information instead, and the ones resolved up to 7 days ago, which are reopened. Same index as the list.
    .get("/:id/tickets/candidates", async (c) => {
      const parsed = candidatesQuery.safeParse(c.req.query());
      if (!parsed.success) return c.json(errorBody("invalid_query", "category must be one of the ticket categories"), 400);
      const employeeId = c.req.param("id");

      const rows = await deps.db
        .select()
        .from(tickets)
        .where(and(eq(tickets.openedBy, employeeId), eq(tickets.category, parsed.data.category)))
        .orderBy(desc(tickets.createdAt), desc(tickets.id));
      if (rows.length === 0 && !(await employeeExists(deps, employeeId))) {
        return c.json(errorBody("employee_not_found", "Employee not found"), 404);
      }
      // The window counts calendar days in São Paulo, so it is checked here, by the same rule the reopening uses.
      const now = deps.now();
      const candidates = rows.filter((row) => row.status !== "resolved" || isReopenable(row, now));
      return c.json(candidates.map(toTicket));
    });
}

async function employeeExists(deps: Deps, id: string) {
  const [row] = await deps.db.select({ id: employees.id }).from(employees).where(eq(employees.id, id));
  return row !== undefined;
}

export function analystRoutes(deps: Deps) {
  return new Hono()
    .get("/", async (c) => {
      const rows: Analyst[] = await deps.db.select().from(analysts).orderBy(asc(analysts.name));
      return c.json(rows);
    })
    // The "Disponível" of the console. Setting the same value twice answers the same, so it needs no key.
    .patch("/:id", async (c) => {
      const parsed = availabilityInput.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json(errorBody("invalid_body", "available must be a boolean"), 400);
      const [row] = await deps.db
        .update(analysts)
        .set({ available: parsed.data.available })
        .where(eq(analysts.id, c.req.param("id")))
        .returning();
      return row ? c.json<Analyst>(row) : c.json(errorBody("analyst_not_found", "Analyst not found"), 404);
    });
}

function toEmployee(row: typeof employees.$inferSelect): Employee {
  return { ...row, passwordChangedAt: row.passwordChangedAt?.toISOString() ?? null };
}
