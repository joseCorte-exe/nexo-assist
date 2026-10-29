import { type AgentModel, createMemory, createNexoAgent, type NexoAgent, simulatedModel } from "@nexo/agent";
import {
  type Analyst,
  createTicketServiceClient,
  dueAt,
  type Employee,
  type KbArticle,
  type Priority,
  sampleAnalysts,
  sampleEmployees,
  type Ticket,
  type TicketDetail,
  type TicketServiceClient,
  type TicketStatus,
} from "@nexo/shared";
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

export const vpnArticle: KbArticle = {
  id: "kb-vpn-809",
  title: "VPN com erro 809",
  content:
    "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.",
  category: "network_vpn",
};

type SampleTicket = Pick<Ticket, "id" | "title" | "openedBy"> & { priority: Priority; status: TicketStatus; openedDaysAgo: number; itAnsweredDaysAgo?: number };

/** Ana's open tickets, as in the design, and one of Diego's. Their rules are tested in the ticket-service. */
const sampleTickets: SampleTicket[] = [
  { id: "INC-20311", title: "Notebook lento após atualização do Windows", openedBy: "emp-ana", priority: "medium", status: "waiting_for_analyst", openedDaysAgo: 6 },
  { id: "INC-20298", title: "Acesso à pasta Financeiro no SharePoint", openedBy: "emp-ana", priority: "medium", status: "in_progress", openedDaysAgo: 8, itAnsweredDaysAgo: 1 },
  { id: "REQ-10442", title: "Segundo monitor para home office", openedBy: "emp-ana", priority: "low", status: "approved", openedDaysAgo: 13, itAnsweredDaysAgo: 7 },
  { id: "INC-20319", title: "Sistema de pedidos fora do ar para a equipe", openedBy: "emp-diego", priority: "critical", status: "waiting_for_analyst", openedDaysAgo: 0 },
];

function toTicket({ openedDaysAgo, itAnsweredDaysAgo, ...sample }: SampleTicket): Ticket {
  const createdAt = new Date(NOW.getTime() - openedDaysAgo * DAY);
  const lastItResponseAt = itAnsweredDaysAgo === undefined ? null : new Date(NOW.getTime() - itAnsweredDaysAgo * DAY);
  return {
    ...sample,
    type: sample.id.startsWith("REQ") ? "REQ" : "INC",
    description: "Descrição do chamado.",
    category: "hardware",
    subcategory: null,
    affected: "only_me",
    assignedTo: null,
    createdAt: createdAt.toISOString(),
    updatedAt: (lastItResponseAt ?? createdAt).toISOString(),
    lastItResponseAt: lastItResponseAt?.toISOString() ?? null,
    dueAt: dueAt({ priority: sample.priority, createdAt, lastItResponseAt }).toISOString(),
    resolvedAt: null,
  };
}

/**
 * The real ticket-service client, answering from the sample people and tickets instead of the network,
 * so tests go through the same lookup rules the app uses. As the service, it never answers another person's ticket.
 */
export function fakeTicketService({ down = false } = {}): TicketServiceClient {
  const employees: Employee[] = sampleEmployees.map((employee) => ({
    ...employee,
    passwordChangedAt: ana.passwordChangedAt,
  }));
  const analysts: Analyst[] = sampleAnalysts.map((analyst) => ({ ...analyst }));
  const tickets = sampleTickets.map(toTicket);
  const fetch = async (url: URL | RequestInfo) => {
    if (down) return Response.json({}, { status: 503 });
    const { pathname, searchParams } = new URL(String(url));
    if (pathname === "/analysts") return Response.json(analysts);
    // The help center only knows the VPN article here; its ranking is tested in the ticket-service.
    if (pathname === "/kb/search") return Response.json(/vpn|809/i.test(searchParams.get("q") ?? "") ? [vpnArticle] : []);
    const list = pathname.match(/^\/employees\/([^/]+)\/tickets$/);
    if (list) return Response.json(tickets.filter((ticket) => ticket.openedBy === decodeURIComponent(list[1]!)));
    const one = pathname.match(/^\/tickets\/([^/]+)$/);
    if (one) {
      const found = tickets.find((ticket) => ticket.id === one[1] && ticket.openedBy === searchParams.get("employeeId"));
      const detail: TicketDetail | undefined = found && { ...found, assigneeName: null, updates: [] };
      return detail ? Response.json(detail) : Response.json({ error: { code: "ticket_not_found", message: "Ticket not found" } }, { status: 404 });
    }
    return Response.json(employees.filter((employee) => employee.email === searchParams.get("email")));
  };
  return createTicketServiceClient({ baseUrl: "http://tickets.test", secret: "s", fetch, sleep: async () => {} });
}

/** The real agent with its own in-memory memory, on the given model (the simulated one by default). */
export function testAgent(model: AgentModel = simulatedModel(), ticketService = fakeTicketService()): NexoAgent {
  return createNexoAgent({ model, memory: createMemory({ url: ":memory:" }), ticketService, now: () => NOW });
}

export type TestDeps = Deps & {
  /** Waits for the work the routes left running after the response, such as saving the agent reply. */
  settled: () => Promise<void>;
};

export async function testDeps(overrides: Partial<Deps> = {}): Promise<TestDeps> {
  const db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, NOW);
  const pending: Promise<unknown>[] = [];
  return {
    db,
    ticketService: fakeTicketService(),
    agent: testAgent(),
    waitUntil: (task) => pending.push(task),
    sessionSecret: SECRET,
    secureCookies: false,
    now: () => NOW,
    ...overrides,
    settled: async () => {
      await Promise.all(pending);
    },
  };
}

/** The chunks of an AI SDK UI message stream (server-sent events), in order. */
export async function readStream(response: Response): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)));
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
