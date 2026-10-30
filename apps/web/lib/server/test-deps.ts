import { type AgentMemory, type AgentModel, createMemory, createNexoAgent, type NexoAgent, simulatedModel } from "@nexo/agent";
import {
  type Analyst,
  canReopen,
  type Category,
  createTicketServiceClient,
  createTicketInput,
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
import { createDraftStore } from "./drafts";
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

type SampleTicket = Pick<Ticket, "id" | "title" | "openedBy"> & {
  priority: Priority;
  status: TicketStatus;
  category?: Category;
  openedDaysAgo: number;
  itAnsweredDaysAgo?: number;
  resolvedDaysAgo?: number;
};

/** Ana's tickets, as in the design and Annex B, and one of Diego's. Their rules are tested in the ticket-service. */
const sampleTickets: SampleTicket[] = [
  { id: "INC-20311", title: "Notebook lento após atualização do Windows", openedBy: "emp-ana", priority: "medium", status: "waiting_for_analyst", openedDaysAgo: 6 },
  { id: "INC-20298", title: "Acesso à pasta Financeiro no SharePoint", openedBy: "emp-ana", priority: "medium", status: "in_progress", category: "access", openedDaysAgo: 8, itAnsweredDaysAgo: 1 },
  { id: "REQ-10442", title: "Segundo monitor para home office", openedBy: "emp-ana", priority: "low", status: "approved", openedDaysAgo: 13, itAnsweredDaysAgo: 7 },
  { id: "INC-20150", title: "Senha do SAP bloqueada", openedBy: "emp-ana", priority: "medium", status: "resolved", category: "access", openedDaysAgo: 5, itAnsweredDaysAgo: 4, resolvedDaysAgo: 4 },
  { id: "INC-19877", title: "Outlook não sincroniza no celular", openedBy: "emp-ana", priority: "low", status: "resolved", category: "email", openedDaysAgo: 15, itAnsweredDaysAgo: 12, resolvedDaysAgo: 12 },
  { id: "INC-20319", title: "Sistema de pedidos fora do ar para a equipe", openedBy: "emp-diego", priority: "critical", status: "waiting_for_analyst", openedDaysAgo: 0 },
];

function toTicket({ openedDaysAgo, itAnsweredDaysAgo, resolvedDaysAgo, category = "hardware", ...sample }: SampleTicket): Ticket {
  const createdAt = new Date(NOW.getTime() - openedDaysAgo * DAY);
  const lastItResponseAt = itAnsweredDaysAgo === undefined ? null : new Date(NOW.getTime() - itAnsweredDaysAgo * DAY);
  return {
    ...sample,
    type: sample.id.startsWith("REQ") ? "REQ" : "INC",
    description: "Descrição do chamado.",
    category,
    subcategory: null,
    affected: "only_me",
    assignedTo: null,
    createdAt: createdAt.toISOString(),
    updatedAt: (lastItResponseAt ?? createdAt).toISOString(),
    lastItResponseAt: lastItResponseAt?.toISOString() ?? null,
    dueAt: dueAt({ priority: sample.priority, createdAt, lastItResponseAt }).toISOString(),
    resolvedAt: resolvedDaysAgo === undefined ? null : new Date(NOW.getTime() - resolvedDaysAgo * DAY).toISOString(),
  };
}

/** A write the fake service received: the route, the body and the idempotency key. */
export type ServiceWrite = { method: string; path: string; body: unknown; key: string | null };
export type FakeTicketService = TicketServiceClient & {
  writes: ServiceWrite[];
  /** Takes the writes down, or brings them back. */
  setWritesDown: (down: boolean) => void;
};

const notFound = () => Response.json({ error: { code: "ticket_not_found", message: "Ticket not found" } }, { status: 404 });
const refused = (code: string, message: string) => Response.json({ error: { code, message } }, { status: 409 });

/**
 * The real ticket-service client, answering from the sample people and tickets instead of the network,
 * so tests go through the same lookup rules the app uses. As the service, it never answers another person's ticket.
 */
export function fakeTicketService({
  down = false,
  writesDown = false,
  onWrite,
}: {
  down?: boolean;
  writesDown?: boolean;
  /** Runs while a write is on its way, before the service answers: what happens meanwhile elsewhere. */
  onWrite?: () => Promise<void>;
} = {}): FakeTicketService {
  const employees: Employee[] = sampleEmployees.map((employee) => ({
    ...employee,
    passwordChangedAt: ana.passwordChangedAt,
  }));
  const analysts: Analyst[] = sampleAnalysts.map((analyst) => ({ ...analyst }));
  const tickets = sampleTickets.map(toTicket);
  const writes: ServiceWrite[] = [];
  const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    if (down) return Response.json({}, { status: 503 });
    const { pathname, searchParams } = new URL(String(url));
    const method = init?.method ?? "GET";
    if (method !== "GET") {
      if (writesDown) return Response.json({}, { status: 503 });
      await onWrite?.();
      const body: unknown = JSON.parse(String(init?.body));
      const key = (init?.headers as Record<string, string> | undefined)?.["idempotency-key"] ?? null;
      writes.push({ method, path: pathname, body, key });
      return write(method, pathname, body);
    }
    if (pathname === "/analysts") return Response.json(analysts);
    // The help center only knows the VPN article here; its ranking is tested in the ticket-service.
    if (pathname === "/kb/search") return Response.json(/vpn|809/i.test(searchParams.get("q") ?? "") ? [vpnArticle] : []);
    const candidates = pathname.match(/^\/employees\/([^/]+)\/tickets\/candidates$/);
    if (candidates) {
      const category = searchParams.get("category");
      // Open, or resolved recently enough to be reopened, as the service answers.
      const sameCase = (ticket: Ticket) => ticket.status !== "resolved" || canReopen(new Date(ticket.resolvedAt!), NOW);
      return Response.json(
        tickets.filter((ticket) => ticket.openedBy === decodeURIComponent(candidates[1]!) && ticket.category === category && sameCase(ticket)),
      );
    }
    const list = pathname.match(/^\/employees\/([^/]+)\/tickets$/);
    if (list) {
      const open = searchParams.get("status") === "open";
      return Response.json(
        tickets.filter((ticket) => ticket.openedBy === decodeURIComponent(list[1]!) && (!open || ticket.status !== "resolved")),
      );
    }
    const one = pathname.match(/^\/tickets\/([^/]+)$/);
    if (one) {
      const found = tickets.find((ticket) => ticket.id === one[1] && ticket.openedBy === searchParams.get("employeeId"));
      const detail: TicketDetail | undefined = found && { ...found, assigneeName: null, updates: [] };
      return detail ? Response.json(detail) : Response.json({ error: { code: "ticket_not_found", message: "Ticket not found" } }, { status: 404 });
    }
    return Response.json(employees.filter((employee) => employee.email === searchParams.get("email")));
  };

  /** The three writes, with the rules the service checks; their idempotency is tested in the service. */
  function write(method: string, path: string, body: unknown) {
    if (method === "POST" && path === "/tickets") {
      const input = createTicketInput.parse(body);
      const created: Ticket = {
        ...input,
        id: "INC-20320",
        status: "waiting_for_analyst",
        openedBy: input.employeeId,
        assignedTo: null,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        lastItResponseAt: null,
        dueAt: dueAt({ priority: input.priority, createdAt: NOW, lastItResponseAt: null }).toISOString(),
        resolvedAt: null,
      };
      return Response.json(created, { status: 201 });
    }
    const [, id, reopen] = path.match(/^\/tickets\/([^/]+)(\/reopen)?$/) ?? [];
    const { employeeId } = body as { employeeId: string };
    const ticket = tickets.find((one) => one.id === id && one.openedBy === employeeId);
    if (!ticket) return notFound();
    if (!reopen) return ticket.status === "resolved" ? refused("ticket_resolved", "The ticket is resolved") : Response.json(ticket);
    if (ticket.status !== "resolved") return refused("ticket_not_resolved", "The ticket is not resolved");
    if (!canReopen(new Date(ticket.resolvedAt!), NOW)) {
      return refused("reopen_window_closed", "The ticket was resolved more than 7 days ago");
    }
    return Response.json({
      ...ticket,
      status: "waiting_for_analyst",
      resolvedAt: null,
      updatedAt: NOW.toISOString(),
      dueAt: dueAt({ priority: ticket.priority, createdAt: NOW, lastItResponseAt: null }).toISOString(),
    });
  }

  const client = createTicketServiceClient({ baseUrl: "http://tickets.test", secret: "s", fetch, sleep: async () => {} });
  return Object.assign(client, {
    writes,
    setWritesDown: (value: boolean) => {
      writesDown = value;
    },
  });
}

/**
 * The real agent on the given model (the simulated one by default), with its own in-memory memory and drafts, or with
 * those of the deps it serves when given.
 */
export function testAgent(
  model: AgentModel = simulatedModel(),
  ticketService = fakeTicketService(),
  { db, memory = createMemory({ url: ":memory:" }) }: { db?: Deps["db"]; memory?: AgentMemory } = {},
): NexoAgent {
  const drafts = createDraftStore(db ?? createDb(":memory:"));
  return createNexoAgent({ model, memory, ticketService, drafts, now: () => NOW });
}

export type TestDeps = Deps & {
  ticketService: FakeTicketService;
  /** Waits for the work the routes left running after the response, such as saving the agent reply. */
  settled: () => Promise<void>;
  /** The text of every note left in the agent memory, in order. */
  notes: string[];
};

type TestOptions = Partial<Omit<Deps, "ticketService">> & {
  ticketService?: FakeTicketService;
  /** The model of an agent that keeps its drafts and memory in these deps, so the routes and the agent share them. */
  model?: AgentModel;
};

export async function testDeps({ model, ...overrides }: TestOptions = {}): Promise<TestDeps> {
  const db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, NOW);
  const pending: Promise<unknown>[] = [];
  const ticketService = overrides.ticketService ?? fakeTicketService();
  const agentMemory = createMemory({ url: ":memory:" });
  const notes: string[] = [];
  const memory: Deps["memory"] = {
    saveMessages: async (args) => {
      for (const message of args.messages) {
        for (const part of message.content.parts) if (part.type === "text") notes.push(part.text);
      }
      return agentMemory.saveMessages(args);
    },
  };
  return {
    db,
    agent: testAgent(model, ticketService, { db, memory: agentMemory }),
    memory,
    waitUntil: (task) => pending.push(task),
    sessionSecret: SECRET,
    secureCookies: false,
    now: () => NOW,
    ...overrides,
    ticketService,
    notes,
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
