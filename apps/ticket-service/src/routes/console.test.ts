import {
  type Analyst,
  createTicketServiceClient,
  type Employee,
  IDEMPOTENCY_KEY_HEADER,
  SERVICE_SECRET_HEADER,
  type Ticket,
} from "@nexo/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDb, type Db } from "../db";
import { migrateDb } from "../db/migrate";
import { analysts, tickets, ticketUpdates } from "../db/schema";
import { seed } from "../seed";

// What the console of feature 5 needs from the ticket-service: the names of the people in the list and in the search,
// the availability of the analyst, and the two marks a transfer leaves on a ticket: transferred, then assumed.

const SECRET = "service-secret";
// Monday 10:00 in São Paulo.
const clock = new Date("2026-10-26T13:00:00Z");

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = createDb(":memory:");
  await migrateDb(db);
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
});
