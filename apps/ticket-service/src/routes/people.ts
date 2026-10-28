import { type Analyst, corporateEmail, type Employee } from "@nexo/shared";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import { analysts, employees } from "../db/schema";

const employeesQuery = z.object({ email: corporateEmail });

export function employeeRoutes(deps: Deps) {
  // A filter over the collection, so it answers a list: empty when nobody has the e-mail.
  return new Hono().get("/", async (c) => {
    const parsed = employeesQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json(errorBody("invalid_query", "email must be a valid e-mail"), 400);

    // Seeded e-mails are lowercase and the column is unique, so this is an index lookup.
    const rows = await deps.db.select().from(employees).where(eq(employees.email, parsed.data.email));
    return c.json(rows.map(toEmployee));
  });
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
