import { type Analyst, candidatesQuery, corporateEmail, type Employee, employeeTicketsStatus, isReopenable } from "@nexo/shared";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import { analysts, employees, tickets } from "../db/schema";
import { toTicket } from "./tickets";

const employeesQuery = z.object({ email: corporateEmail() });
const ticketsQuery = z.object({ status: employeeTicketsStatus.optional() });

export function employeeRoutes(deps: Deps) {
  // A filter over the collection, so it answers a list: empty when nobody has the e-mail.
  return new Hono().get("/", async (c) => {
    const parsed = employeesQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json(errorBody("invalid_query", "email must be a valid e-mail"), 400);

    // Seeded e-mails are lowercase and the column is unique, so this is an index lookup.
    const rows = await deps.db.select().from(employees).where(eq(employees.email, parsed.data.email));
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
  return new Hono().get("/", async (c) => {
    const rows: Analyst[] = await deps.db.select().from(analysts).orderBy(asc(analysts.name));
    return c.json(rows);
  });
}

function toEmployee(row: typeof employees.$inferSelect): Employee {
  return { ...row, passwordChangedAt: row.passwordChangedAt?.toISOString() ?? null };
}
