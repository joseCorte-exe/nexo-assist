import {
  type Analyst,
  createTicketServiceClient,
  dueAt,
  type Employee,
  IDEMPOTENCY_KEY_HEADER,
  SERVICE_SECRET_HEADER,
  type Ticket,
  type TicketDetail,
} from "@nexo/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDb, type Db } from "../db";
import { migrateDb } from "../db/migrate";
import { analysts, tickets, ticketUpdates } from "../db/schema";
import { seed } from "../seed";

// What the console of feature 5 needs from the ticket-service: the names of the people in the list and in the search,
// the availability of the analyst, the two marks a transfer leaves on a ticket (transferred, then assumed), and the
// answer of an analyst, which restarts the deadline.

const SECRET = "service-secret";
// Monday 10:00 in São Paulo.
const start = new Date("2026-10-26T13:00:00Z");
const HOUR = 60 * 60 * 1000;

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: Date;

beforeEach(async () => {
  db = createDb(":memory:");
  await migrateDb(db);
  clock = start;
  await seed(db, clock);
  app = createApp({ db, serviceSecret: SECRET, adminKey: "admin", outageRate: 0, now: () => clock, random: () => 0.99 });
});

const get = (path: string) => app.request(path, { headers: { [SERVICE_SECRET_HEADER]: SECRET } });

function write(method: "PATCH" | "POST", path: string, body: unknown, key?: string) {
  const headers: Record<string, string> = { [SERVICE_SECRET_HEADER]: SECRET, "content-type": "application/json" };
  if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = key;
  return app.request(path, { method, headers, body: JSON.stringify(body) });
}

const names = async (response: Response) => ((await response.json()) as Employee[]).map((employee) => employee.name);
const error = (code: string, message: string) => ({ error: { code, message } });

describe("GET /employees?ids=", () => {
  it("returns the employees with those ids, by name", async () => {
    const response = await get("/employees?ids=emp-carla,emp-ana,emp-nobody");
    expect(response.status).toBe(200);
    expect(await names(response)).toEqual(["Ana Souza", "Carla Mendes"]);
  });

  it("refuses more ids than a page of the console has", async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `emp-${index}`).join(",");
    expect((await get(`/employees?ids=${ids}`)).status).toBe(400);
  });
});

describe("GET /employees?q=", () => {
  it("finds employees by a part of the name, whatever the case", async () => {
    expect(await names(await get("/employees?q=ana"))).toEqual(["Ana Souza"]);
    expect(await names(await get("/employees?q=SOUZA"))).toEqual(["Ana Souza"]);
    expect(await names(await get("/employees?q=r"))).toContain("Carla Mendes");
  });

  it("takes the wildcards of LIKE as letters", async () => {
    expect(await names(await get(`/employees?q=${encodeURIComponent("%")}`))).toEqual([]);
    expect(await names(await get("/employees?q=_"))).toEqual([]);
  });

  it("needs exactly one of email, ids or q", async () => {
    expect((await get("/employees")).status).toBe(400);
    expect((await get("/employees?q=ana&ids=emp-ana")).status).toBe(400);
  });
});

describe("PATCH /analysts/:id", () => {
  it("sets the availability and answers the analyst", async () => {
    const response = await write("PATCH", "/analysts/analyst-rafael", { available: false });
    expect(response.status).toBe(200);
    expect(((await response.json()) as Analyst).available).toBe(false);
    const [row] = await db.select().from(analysts).where(eq(analysts.id, "analyst-rafael"));
    expect(row?.available).toBe(false);
  });

  it("answers 404 for an analyst that does not exist and 400 for a bad body", async () => {
    expect((await write("PATCH", "/analysts/analyst-nobody", { available: true })).status).toBe(404);
    expect((await write("PATCH", "/analysts/analyst-rafael", { available: "yes" })).status).toBe(400);
  });
});

const transferBody = { employeeId: "emp-ana", level: "N2" as const, summary: "Notebook lento há 6 dias; o INC-20311 venceu e a Ana pediu um analista." };
const updatesOf = (id: string) =>
  db.select({ author: ticketUpdates.author, text: ticketUpdates.text }).from(ticketUpdates).where(eq(ticketUpdates.ticketId, id));

describe("POST /tickets/:id/transfer", () => {
  it("adds the transfer to the history of the ticket as an update of the agent, with the level and the summary", async () => {
    const before = await db.select().from(tickets).where(eq(tickets.id, "INC-20311"));
    const response = await write("POST", "/tickets/INC-20311/transfer", transferBody, "note-1");
    expect(response.status).toBe(200);
    expect(((await response.json()) as Ticket).id).toBe("INC-20311");
    expect(await updatesOf("INC-20311")).toContainEqual({
      author: "agent",
      text: `Transferido para o Suporte N2. ${transferBody.summary}`,
    });
    // The agent is not IT: the last update and the deadline still count IT's answers (RN-02).
    const [after] = await db.select().from(tickets).where(eq(tickets.id, "INC-20311"));
    expect(after?.updatedAt).toEqual(before[0]?.updatedAt);
    expect(after?.dueAt).toEqual(before[0]?.dueAt);
  });

  it("writes it once per key", async () => {
    const first = await write("POST", "/tickets/INC-20311/transfer", transferBody, "note-1");
    const again = await write("POST", "/tickets/INC-20311/transfer", transferBody, "note-1");
    expect(await again.json()).toEqual(await first.json());
    expect((await updatesOf("INC-20311")).filter((update) => update.author === "agent")).toHaveLength(1);
  });

  it("answers somebody else's ticket as a missing one", async () => {
    const response = await write("POST", "/tickets/INC-20319/transfer", transferBody, "note-1");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(error("ticket_not_found", "Ticket not found"));
  });

  it("needs the key and a valid body", async () => {
    expect((await write("POST", "/tickets/INC-20311/transfer", transferBody)).status).toBe(400);
    expect((await write("POST", "/tickets/INC-20311/transfer", { ...transferBody, level: "N3" }, "note-1")).status).toBe(400);
  });
});

const assignBody = { employeeId: "emp-ana", analystId: "analyst-rafael" };

describe("POST /tickets/:id/assign", () => {
  it("puts a ticket waiting for an analyst in service, with the analyst", async () => {
    const response = await write("POST", "/tickets/INC-20311/assign", assignBody, "note-2");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "INC-20311", status: "assigned", assignedTo: "analyst-rafael" });
  });

  it("does not move a ticket IT already took further, nor a resolved one", async () => {
    const inProgress = await write("POST", "/tickets/INC-20298/assign", assignBody, "note-3");
    expect(await inProgress.json()).toMatchObject({ status: "in_progress", assignedTo: "analyst-juliana" });
    const resolved = await write("POST", "/tickets/INC-20150/assign", assignBody, "note-4");
    expect(await resolved.json()).toMatchObject({ status: "resolved" });
  });

  it("leaves the deadline and the last update as they were: assuming is not an answer of IT (RN-02)", async () => {
    const [before] = await db.select().from(tickets).where(eq(tickets.id, "INC-20311"));
    clock = new Date(start.getTime() + HOUR);
    await write("POST", "/tickets/INC-20311/assign", assignBody, "note-2");
    const [after] = await db.select().from(tickets).where(eq(tickets.id, "INC-20311"));
    expect(after?.dueAt).toEqual(before?.dueAt);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.lastItResponseAt).toEqual(before?.lastItResponseAt);
  });

  it("hands an assigned ticket to the analyst who assumed the conversation now", async () => {
    await write("POST", "/tickets/INC-20311/assign", assignBody, "note-2");
    const again = await write("POST", "/tickets/INC-20311/assign", { ...assignBody, analystId: "analyst-larissa" }, "note-5");
    expect(await again.json()).toMatchObject({ status: "assigned", assignedTo: "analyst-larissa" });
  });

  it("refuses an analyst that does not exist and somebody else's ticket", async () => {
    const unknown = await write("POST", "/tickets/INC-20311/assign", { ...assignBody, analystId: "analyst-nobody" }, "note-6");
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual(error("unknown_analyst", "Analyst not found"));
    expect((await write("POST", "/tickets/INC-20319/assign", assignBody, "note-7")).status).toBe(404);
  });
});

const answerBody = { employeeId: "emp-ana", text: "Oi, Ana! Pode deixar o notebook ligado agora?" };
const answer = (id: string, body: unknown = answerBody, key = "msg-1") => write("POST", `/tickets/${id}/answer`, body, key);
const ticketRow = async (id: string) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0]!;

describe("POST /tickets/:id/answer", () => {
  it("records the answer of IT: the last answer, the last update, the deadline and the line in the history", async () => {
    const response = await answer("INC-20311");
    expect(response.status).toBe(200);
    // Medium: 3 business days from Monday 10:00 is Thursday 10:00 in São Paulo. It was overdue before.
    expect(await response.json()).toMatchObject({
      id: "INC-20311",
      status: "waiting_for_analyst",
      lastItResponseAt: start.toISOString(),
      updatedAt: start.toISOString(),
      dueAt: "2026-10-29T13:00:00.000Z",
    });
    const saved = await ticketRow("INC-20311");
    expect(saved.lastItResponseAt).toEqual(start);
    expect(saved.updatedAt).toEqual(start);
    expect(saved.dueAt).toEqual(new Date("2026-10-29T13:00:00.000Z"));
    expect(await updatesOf("INC-20311")).toEqual([{ author: "analyst", text: answerBody.text }]);
  });

  it("gives the agent what IT wrote last, in the detail of the ticket", async () => {
    await answer("INC-20298", { employeeId: "emp-ana", text: "O dono da pasta liberou." });
    const detail = (await (await get("/tickets/INC-20298?employeeId=emp-ana")).json()) as TicketDetail;
    expect(detail.updates.at(-1)).toMatchObject({ author: "analyst", text: "O dono da pasta liberou." });
  });

  it("restarts with the deadline of the priority", async () => {
    // Critical counts 1 hour around the clock; low, 5 business days.
    const critical = await answer("INC-20319", { employeeId: "emp-diego", text: "Estou olhando." }, "msg-critical");
    expect(((await critical.json()) as Ticket).dueAt).toBe("2026-10-26T14:00:00.000Z");
    const low = await answer("REQ-10442", { employeeId: "emp-ana", text: "Sai amanhã." }, "msg-low");
    expect(((await low.json()) as Ticket).dueAt).toBe("2026-11-02T13:00:00.000Z");
  });

  it("restarts again at each answer", async () => {
    await answer("INC-20311", answerBody, "msg-1");
    clock = new Date(start.getTime() + 2 * HOUR);
    const later = (await (await answer("INC-20311", answerBody, "msg-2")).json()) as Ticket;
    expect(later.lastItResponseAt).toBe(clock.toISOString());
    expect(later.dueAt).toBe("2026-10-29T15:00:00.000Z");
    expect(await updatesOf("INC-20311")).toHaveLength(2);
  });

  it("counts from the answer on a reopened ticket, and any later count of the deadline agrees", async () => {
    await write("POST", "/tickets/INC-20150/reopen", { employeeId: "emp-ana", text: "De novo." }, "draft-1");
    clock = new Date(start.getTime() + 2 * HOUR);
    const answered = (await (await answer("INC-20150")).json()) as Ticket;
    expect(answered.dueAt).toBe("2026-10-29T15:00:00.000Z");
    const saved = await ticketRow("INC-20150");
    expect(dueAt(saved)).toEqual(saved.dueAt);
  });

  it("writes it once per key: a retry answers the same, and the deadline stays", async () => {
    const first = await (await answer("INC-20311")).json();
    clock = new Date(start.getTime() + 2 * HOUR);
    const again = await answer("INC-20311");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(await updatesOf("INC-20311")).toHaveLength(1);
    expect((await ticketRow("INC-20311")).lastItResponseAt).toEqual(start);
  });

  it("saves it when an outage falls before the answer; the retry gets it, added once", async () => {
    // Opens the outage, 1 second window, saves first.
    const randoms = [0, 0, 0];
    const falling = createApp({ db, serviceSecret: SECRET, adminKey: "admin", outageRate: 0.1, now: () => clock, random: () => randoms.shift() ?? 0.99 });
    const client = createTicketServiceClient({
      baseUrl: "http://tickets.test",
      secret: SECRET,
      fetch: async (url, init) => falling.request(String(url), init),
      sleep: async (ms) => {
        clock = new Date(clock.getTime() + ms);
      },
      backoffMs: [600, 900],
    });
    const result = await client.answerTicket("INC-20311", answerBody, "msg-1");
    expect(result.ok && result.data.lastItResponseAt).toBe(start.toISOString());
    expect(await updatesOf("INC-20311")).toEqual([{ author: "analyst", text: answerBody.text }]);
  });

  it("refuses a key used for another ticket, and writes nothing", async () => {
    await answer("INC-20311");
    const before = await ticketRow("INC-20298");
    expect((await answer("INC-20298")).status).toBe(422);
    expect(await ticketRow("INC-20298")).toEqual(before);
  });

  it("does not restart the deadline of a resolved ticket: it refuses, and changes nothing", async () => {
    const before = await ticketRow("INC-20150");
    const history = await updatesOf("INC-20150");
    const response = await answer("INC-20150");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(error("ticket_resolved", "The ticket is resolved"));
    expect(await ticketRow("INC-20150")).toEqual(before);
    expect(await updatesOf("INC-20150")).toEqual(history);
  });

  it("answers the same 404 for a ticket of somebody else and for one that does not exist, and writes nothing", async () => {
    const theirs = await answer("INC-20319");
    const missing = await answer("INC-99999");
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(error("ticket_not_found", "Ticket not found"));
    expect(await missing.json()).toEqual(error("ticket_not_found", "Ticket not found"));
    expect(await updatesOf("INC-20319")).toEqual([]);
  });

  it("needs the key, a valid body and a ticket number", async () => {
    expect((await write("POST", "/tickets/INC-20311/answer", answerBody)).status).toBe(400);
    expect((await answer("INC-20311", { employeeId: "emp-ana", text: " " })).status).toBe(400);
    expect((await answer("INC-20311", { text: "Oi" })).status).toBe(400);
    expect((await answer("drop-table")).status).toBe(400);
    expect(await updatesOf("INC-20311")).toEqual([]);
  });

  it("needs the service secret", async () => {
    const response = await app.request("/tickets/INC-20311/answer", {
      method: "POST",
      headers: { [SERVICE_SECRET_HEADER]: "wrong", "content-type": "application/json", [IDEMPOTENCY_KEY_HEADER]: "msg-1" },
      body: JSON.stringify(answerBody),
    });
    expect(response.status).toBe(401);
    expect(await updatesOf("INC-20311")).toEqual([]);
  });
});

describe("the client of the console", () => {
  const client = createTicketServiceClient({
    baseUrl: "http://ticket-service",
    secret: SECRET,
    fetch: async (input, init) => app.request(input instanceof URL ? input.pathname + input.search : String(input), init),
    backoffMs: [],
  });

  it("reads the people of a page and searches them by name", async () => {
    const page = await client.listEmployeesByIds(["emp-ana", "emp-diego"]);
    expect(page.ok && page.data.map((employee) => employee.id)).toEqual(["emp-ana", "emp-diego"]);
    const found = await client.searchEmployees("tavares");
    expect(found.ok && found.data.map((employee) => employee.id)).toEqual(["emp-bruno"]);
    // Nobody to look up is answered without a call.
    expect(await client.listEmployeesByIds([])).toEqual({ ok: true, data: [] });
  });

  it("sets the availability, transfers and assigns", async () => {
    const availability = await client.setAvailability("analyst-rafael", false);
    expect(availability.ok && availability.data.available).toBe(false);
    const transfer = await client.transferTicket("INC-20311", transferBody, "note-1");
    expect(transfer.ok && transfer.data.id).toBe("INC-20311");
    const assign = await client.assignTicket("INC-20311", assignBody, "note-2");
    expect(assign.ok && assign.data.status).toBe("assigned");
  });

  it("notes the answer of an analyst, and tells a resolved ticket by the code it refused with", async () => {
    const answered = await client.answerTicket("INC-20311", answerBody, "msg-1");
    expect(answered.ok && answered.data.lastItResponseAt).toBe(start.toISOString());
    const resolved = await client.answerTicket("INC-20150", answerBody, "msg-2");
    expect(!resolved.ok && resolved.error.serviceCode).toBe("ticket_resolved");
  });
});
