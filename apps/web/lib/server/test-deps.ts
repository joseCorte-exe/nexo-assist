import { type Analyst, type Employee, sampleAnalysts, sampleEmployees, type TicketServiceResult } from "@nexo/shared";
import { NextRequest } from "next/server";
import { createDb, migrateDb } from "@/db";
import { seed } from "@/db/seed";
import type { Deps } from "./deps";
import { createSession, SESSION_COOKIE, type SessionUser, signSession } from "./session";

// Test helpers: a real in-memory conversations DB and an in-memory ticket-service with the sample people.

export const NOW = new Date("2026-10-26T13:00:00Z");
export const SECRET = "test-session-secret-0123456789";
const DAY = 24 * 60 * 60 * 1000;

export const ana: Employee = {
  ...sampleEmployees[0],
  passwordChangedAt: new Date(NOW.getTime() - 42 * DAY).toISOString(),
};
export const rafael: Analyst = { ...sampleAnalysts[0] };

const unavailable = { ok: false, error: { code: "unavailable", status: 503, message: "down" } } as const;

export function fakeTicketService({ down = false } = {}): Deps["ticketService"] {
  const employees: Employee[] = sampleEmployees.map((employee) => ({ ...employee, passwordChangedAt: ana.passwordChangedAt }));
  const analysts: Analyst[] = sampleAnalysts.map((analyst) => ({ ...analyst }));
  return {
    findEmployeeByEmail: async (email): Promise<TicketServiceResult<Employee | null>> =>
      down ? unavailable : { ok: true, data: employees.find((employee) => employee.email === email) ?? null },
    listAnalysts: async (): Promise<TicketServiceResult<Analyst[]>> => (down ? unavailable : { ok: true, data: analysts }),
  };
}

export async function testDeps(overrides: Partial<Deps> = {}): Promise<Deps> {
  const db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, NOW);
  return { db, ticketService: fakeTicketService(), sessionSecret: SECRET, secureCookies: false, now: () => NOW, ...overrides };
}

export async function sessionCookieFor(user: SessionUser) {
  return `${SESSION_COOKIE}=${await signSession(createSession(user, { remember: true, now: NOW }), SECRET)}`;
}

export function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
}
