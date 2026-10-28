import { type Analyst, createTicketServiceClient, type Employee, sampleAnalysts, sampleEmployees } from "@nexo/shared";
import { NextRequest } from "next/server";
import { createDb } from "@/db";
import { migrateDb } from "@/db/migrate";
import { seed } from "@/db/seed";
import type { Deps } from "./deps";
import { createSession, SESSION_COOKIE, type SessionPerson, signSession } from "./session";

// Test helpers: a real in-memory conversations DB and an in-memory ticket-service with the sample people.

export const NOW = new Date("2026-10-26T13:00:00Z");
export const SECRET = "test-session-secret-0123456789";
const DAY = 24 * 60 * 60 * 1000;

export const ana: Employee = {
  ...sampleEmployees[0],
  passwordChangedAt: new Date(NOW.getTime() - 42 * DAY).toISOString(),
};
export const rafael: Analyst = { ...sampleAnalysts[0] };

/**
 * The real ticket-service client, answering from the sample people instead of the network,
 * so tests go through the same lookup rules the app uses.
 */
export function fakeTicketService({ down = false } = {}): Deps["ticketService"] {
  const employees: Employee[] = sampleEmployees.map((employee) => ({
    ...employee,
    passwordChangedAt: ana.passwordChangedAt,
  }));
  const analysts: Analyst[] = sampleAnalysts.map((analyst) => ({ ...analyst }));
  const fetch = async (url: URL | RequestInfo) => {
    if (down) return Response.json({}, { status: 503 });
    const { pathname, searchParams } = new URL(String(url));
    if (pathname === "/analysts") return Response.json(analysts);
    return Response.json(employees.filter((employee) => employee.email === searchParams.get("email")));
  };
  return createTicketServiceClient({ baseUrl: "http://tickets.test", secret: "s", fetch, sleep: async () => {} });
}

export async function testDeps(overrides: Partial<Deps> = {}): Promise<Deps> {
  const db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, NOW);
  return {
    db,
    ticketService: fakeTicketService(),
    sessionSecret: SECRET,
    secureCookies: false,
    now: () => NOW,
    ...overrides,
  };
}

export async function sessionCookieFor(person: SessionPerson) {
  return `${SESSION_COOKIE}=${await signSession(createSession(person, { remember: true, now: NOW }), SECRET)}`;
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
