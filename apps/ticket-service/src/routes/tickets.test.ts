import { SERVICE_SECRET_HEADER, type Ticket, type TicketDetail } from "@nexo/shared";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDb, type Db } from "../db";
import { migrateDb } from "../db/migrate";
import { seed } from "../seed";

const SECRET = "service-secret";
// Monday 10:00 in São Paulo.
const clock = new Date("2026-10-26T13:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let app: ReturnType<typeof createApp>;
let db: Db;

beforeEach(async () => {
  db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, clock);
  app = createApp({ db, serviceSecret: SECRET, adminKey: "admin", outageRate: 0, now: () => clock, random: () => 0.99 });
});

const get = (path: string, secret = SECRET) => app.request(path, { headers: { [SERVICE_SECRET_HEADER]: secret } });
const ids = async (response: Response) => ((await response.json()) as Ticket[]).map((ticket) => ticket.id);

describe("GET /employees/:id/tickets", () => {
  it("returns every ticket of the employee, most recent first", async () => {
    const response = await get("/employees/emp-ana/tickets");
    expect(response.status).toBe(200);
    expect(await ids(response)).toEqual(["INC-20150", "INC-20311", "INC-20298", "REQ-10442", "INC-19877", "INC-19410"]);
  });

  it("leaves the resolved ones out with status=open, in the order of the design", async () => {
    expect(await ids(await get("/employees/emp-ana/tickets?status=open"))).toEqual(["INC-20311", "INC-20298", "REQ-10442"]);
  });

  it("returns the tickets whole, with the deadline of RN-02", async () => {
    const [first] = (await (await get("/employees/emp-ana/tickets?status=open")).json()) as Ticket[];
    expect(first).toMatchObject({
      id: "INC-20311",
      title: "Notebook lento após atualização do Windows",
      priority: "medium",
      status: "waiting_for_analyst",
      openedBy: "emp-ana",
      createdAt: new Date(clock.getTime() - 6 * DAY).toISOString(),
      lastItResponseAt: null,
    });
    expect(first?.dueAt).toBeDefined();
  });

  it("never returns the tickets of somebody else", async () => {
    expect(await ids(await get("/employees/emp-diego/tickets"))).toEqual(["INC-20319"]);
  });

  it("answers an empty list for an employee without tickets", async () => {
    const response = await get("/employees/emp-elisa/tickets");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("answers 404 for an employee that does not exist", async () => {
    const response = await get("/employees/emp-ninguem/tickets");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "employee_not_found", message: "Employee not found" } });
  });

  it("rejects an unknown status", async () => {
    expect((await get("/employees/emp-ana/tickets?status=late")).status).toBe(400);
  });

  it("needs the service secret", async () => {
    expect((await get("/employees/emp-ana/tickets", "wrong")).status).toBe(401);
  });

  it("finds the tickets of an employee through the index, without scanning the table", async () => {
    const plan = await db.all<{ detail: string }>(
      sql`explain query plan select * from tickets where opened_by = 'emp-ana' order by created_at desc`,
    );
    expect(plan.map((row) => row.detail).join(" | ")).toContain("USING INDEX tickets_opened_by_created_at_idx");
  });
});

describe("GET /tickets/:id?employeeId=", () => {
  it("returns the ticket with the analyst who took it and the updates", async () => {
    const response = await get("/tickets/REQ-10442?employeeId=emp-ana");
    expect(response.status).toBe(200);
    const detail = (await response.json()) as TicketDetail;
    expect(detail).toMatchObject({ id: "REQ-10442", status: "approved", assignedTo: "analyst-juliana", assigneeName: "Juliana Costa" });
    expect(detail.updates).toEqual([
      {
        author: "analyst",
        text: "Pedido aprovado pelo gestor. O monitor será enviado.",
        createdAt: new Date(clock.getTime() - 7 * DAY).toISOString(),
      },
    ]);
  });

  it("returns a ticket nobody took yet, without updates", async () => {
    const detail = (await (await get("/tickets/INC-20311?employeeId=emp-ana")).json()) as TicketDetail;
    expect(detail).toMatchObject({ id: "INC-20311", assignedTo: null, assigneeName: null, updates: [] });
  });

  it("reads the number whatever its case", async () => {
    expect((await get("/tickets/inc-20311?employeeId=emp-ana")).status).toBe(200);
  });

  it("answers the same 404 for a ticket of somebody else and for one that does not exist", async () => {
    const theirs = await get("/tickets/INC-20319?employeeId=emp-ana");
    const missing = await get("/tickets/INC-99999?employeeId=emp-ana");
    expect(theirs.status).toBe(404);
    expect(missing.status).toBe(404);
    const body = { error: { code: "ticket_not_found", message: "Ticket not found" } };
    expect(await theirs.json()).toEqual(body);
    expect(await missing.json()).toEqual(body);
  });

  it("needs the employee, and a ticket number", async () => {
    expect((await get("/tickets/INC-20311")).status).toBe(400);
    expect((await get("/tickets/INC-20311?employeeId=")).status).toBe(400);
    expect((await get("/tickets/drop-table?employeeId=emp-ana")).status).toBe(400);
  });

  it("needs the service secret", async () => {
    expect((await get("/tickets/INC-20311?employeeId=emp-ana", "wrong")).status).toBe(401);
  });
});
