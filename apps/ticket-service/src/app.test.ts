import {
  ADMIN_KEY_HEADER,
  type CreateTicketInput,
  createTicketServiceClient,
  IDEMPOTENCY_KEY_HEADER,
  isOverdue,
  SERVICE_SECRET_HEADER,
} from "@nexo/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createDb, type Db } from "./db";
import { migrateDb } from "./db/migrate";
import { tickets } from "./db/schema";
import { seed } from "./seed";

const SECRET = "service-secret";
const ADMIN_KEY = "admin-key";

const input: CreateTicketInput = {
  employeeId: "emp-ana",
  type: "INC",
  title: "VPN com erro 809",
  description: "A VPN mostra erro 809 desde cedo.",
  category: "network_vpn",
  subcategory: "VPN",
  priority: "high",
  affected: "only_me",
};

let db: Db;
let clock: Date;

beforeEach(async () => {
  db = createDb(":memory:");
  await migrateDb(db);
  // Monday 10:00 in São Paulo.
  clock = new Date("2026-10-26T13:00:00Z");
  await seed(db, clock);
});

function appWith({ outageRate = 0, randoms = [] as number[] } = {}) {
  return createApp({
    db,
    serviceSecret: SECRET,
    adminKey: ADMIN_KEY,
    outageRate,
    now: () => clock,
    random: () => randoms.shift() ?? 0.99,
  });
}

const headers = (extra: Record<string, string> = {}) => ({
  [SERVICE_SECRET_HEADER]: SECRET,
  "content-type": "application/json",
  ...extra,
});

const createTicket = (app: ReturnType<typeof createApp>, key = "draft-1", body: unknown = input) =>
  app.request("/tickets", {
    method: "POST",
    headers: headers({ [IDEMPOTENCY_KEY_HEADER]: key }),
    body: JSON.stringify(body),
  });

const countTickets = async () => (await db.select().from(tickets)).length;

describe("secret", () => {
  it("refuses a request without the service secret", async () => {
    const response = await appWith().request("/tickets", { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("refuses admin routes without the admin key", async () => {
    const response = await appWith().request("/admin/reseed", { method: "POST", headers: headers() });
    expect(response.status).toBe(401);
  });
});

describe("POST /tickets", () => {
  it("creates the ticket with the next id, waiting for an analyst, with its deadline", async () => {
    const response = await createTicket(appWith());
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: "INC-20320",
      status: "waiting_for_analyst",
      openedBy: "emp-ana",
      createdAt: "2026-10-26T13:00:00.000Z",
      // High: 4 business hours, so 14:00 in São Paulo.
      dueAt: "2026-10-26T17:00:00.000Z",
    });
  });

  it("returns the saved ticket for a repeated key without creating another", async () => {
    const app = appWith();
    const before = await countTickets();
    const first = await (await createTicket(app)).json();
    const second = await createTicket(app);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(first);
    expect(await countTickets()).toBe(before + 1);
  });

  it("requires an idempotency key", async () => {
    const response = await appWith().request("/tickets", { method: "POST", headers: headers(), body: JSON.stringify(input) });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid body", async () => {
    const response = await createTicket(appWith(), "draft-1", { ...input, title: "" });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown employee", async () => {
    const response = await createTicket(appWith(), "draft-1", { ...input, employeeId: "emp-nobody" });
    expect(response.status).toBe(400);
  });
});

describe("simulated outages", () => {
  it("answers 503 during a forced window, keeps admin up, and recovers after it", async () => {
    const app = appWith();
    const forced = await app.request("/admin/outage?seconds=5", {
      method: "POST",
      headers: headers({ [ADMIN_KEY_HEADER]: ADMIN_KEY }),
    });
    expect(forced.status).toBe(200);

    expect((await createTicket(app)).status).toBe(503);
    expect(
      (await app.request("/admin/reseed", { method: "POST", headers: headers({ [ADMIN_KEY_HEADER]: ADMIN_KEY }) })).status,
    ).toBe(200);

    clock = new Date(clock.getTime() + 6000);
    expect((await createTicket(app)).status).toBe(201);
  });

  it("can fall before doing anything", async () => {
    const before = await countTickets();
    // Opens the outage, 1 second window, does not save first.
    const response = await createTicket(appWith({ outageRate: 0.1, randoms: [0, 0, 0.9] }));
    expect(response.status).toBe(503);
    expect(await countTickets()).toBe(before);
  });

  it("can save the ticket and fall before answering; the retry gets the saved ticket", async () => {
    const before = await countTickets();
    // Opens the outage, 1 second window, saves first.
    const app = appWith({ outageRate: 0.1, randoms: [0, 0, 0] });
    const client = createTicketServiceClient({
      baseUrl: "http://tickets.test",
      secret: SECRET,
      fetch: async (url, init) => app.request(String(url), init),
      sleep: async (ms) => {
        clock = new Date(clock.getTime() + ms);
      },
      backoffMs: [600, 900],
    });

    const result = await client.createTicket(input, "draft-1");

    expect(result.ok && result.data.id).toBe("INC-20320");
    expect(await countTickets()).toBe(before + 1);
  });
});

describe("seed", () => {
  it("has the Annex B tickets with dates relative to when it runs", async () => {
    const [slowLaptop] = await db.select().from(tickets).where(eq(tickets.id, "INC-20311"));
    expect(slowLaptop).toMatchObject({
      title: "Notebook lento após atualização do Windows",
      category: "hardware",
      subcategory: "Notebook",
      priority: "medium",
      status: "waiting_for_analyst",
      createdAt: new Date(clock.getTime() - 6 * 24 * 60 * 60 * 1000),
    });
    expect(slowLaptop && isOverdue(slowLaptop, clock)).toBe(true);

    const [sapPassword] = await db.select().from(tickets).where(eq(tickets.id, "INC-20150"));
    expect(sapPassword).toMatchObject({ status: "resolved", resolvedAt: new Date(clock.getTime() - 4 * 24 * 60 * 60 * 1000) });
  });
});
