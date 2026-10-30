import {
  createTicketServiceClient,
  IDEMPOTENCY_KEY_HEADER,
  SERVICE_SECRET_HEADER,
  type Ticket,
  type TicketDetail,
} from "@nexo/shared";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDb, type Db } from "../db";
import { migrateDb } from "../db/migrate";
import { tickets, ticketUpdates } from "../db/schema";
import { seed } from "../seed";

// The writes of feature 4: the follow-up of an open ticket and the reopening of a resolved one, both confirmed by the
// employee in the chat, plus the lookup of the open tickets a new one could duplicate.

const SECRET = "service-secret";
// Monday 10:00 in São Paulo.
const start = new Date("2026-10-26T13:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let db: Db;
let clock: Date;

beforeEach(async () => {
  db = createDb(":memory:");
  await migrateDb(db);
  clock = start;
  await seed(db, clock);
});

function appWith({ outageRate = 0, randoms = [] as number[] } = {}) {
  return createApp({
    db,
    serviceSecret: SECRET,
    adminKey: "admin",
    outageRate,
    now: () => clock,
    random: () => randoms.shift() ?? 0.99,
  });
}

const get = (path: string) => appWith().request(path, { headers: { [SERVICE_SECRET_HEADER]: SECRET } });

function write(method: "PATCH" | "POST", path: string, body: unknown, key?: string, app = appWith()) {
  const headers: Record<string, string> = { [SERVICE_SECRET_HEADER]: SECRET, "content-type": "application/json" };
  if (key !== undefined) headers[IDEMPOTENCY_KEY_HEADER] = key;
  return app.request(path, { method, headers, body: JSON.stringify(body) });
}

const followUp = (id: string, body: unknown = { employeeId: "emp-ana", text: "Agora trava também ao abrir o Teams." }, key = "draft-7") =>
  write("PATCH", `/tickets/${id}`, body, key);
const reopen = (id: string, body: unknown = { employeeId: "emp-ana", text: "A senha bloqueou de novo hoje cedo." }, key = "draft-8") =>
  write("POST", `/tickets/${id}/reopen`, body, key);

async function row(id: string) {
  const [found] = await db.select().from(tickets).where(eq(tickets.id, id));
  return found!;
}
const updatesOf = (id: string) =>
  db.select({ author: ticketUpdates.author, text: ticketUpdates.text }).from(ticketUpdates).where(eq(ticketUpdates.ticketId, id));
const error = (code: string, message: string) => ({ error: { code, message } });

describe("GET /employees/:id/tickets/candidates?category=", () => {
  const ids = async (response: Response) => ((await response.json()) as Ticket[]).map((ticket) => ticket.id);

  it("returns the open tickets of the employee in that category, most recent first", async () => {
    // INC-19410, also hardware, was resolved 30 days ago: too late to be the same case.
    expect(await ids(await get("/employees/emp-ana/tickets/candidates?category=hardware"))).toEqual(["INC-20311", "REQ-10442"]);
  });

  it("brings the ones resolved up to 7 days ago too, which are reopened rather than duplicated", async () => {
    // INC-20150 was resolved 4 days ago and is also access.
    expect(await ids(await get("/employees/emp-ana/tickets/candidates?category=access"))).toEqual(["INC-20150", "INC-20298"]);
    // INC-19877 was resolved 12 days ago.
    expect(await ids(await get("/employees/emp-ana/tickets/candidates?category=email"))).toEqual([]);
  });

  it("answers an empty list when nothing open looks like it", async () => {
    const response = await get("/employees/emp-ana/tickets/candidates?category=network_vpn");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("never returns the tickets of somebody else", async () => {
    // Fábio's VPN ticket is network_vpn too.
    expect(await ids(await get("/employees/emp-ana/tickets/candidates?category=network_vpn"))).not.toContain("INC-20302");
  });

  it("needs a known category, and an employee that exists", async () => {
    expect((await get("/employees/emp-ana/tickets/candidates")).status).toBe(400);
    expect((await get("/employees/emp-ana/tickets/candidates?category=vpn")).status).toBe(400);
    const missing = await get("/employees/emp-ninguem/tickets/candidates?category=hardware");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(error("employee_not_found", "Employee not found"));
  });

  it("finds them through the index of the employee's tickets, without scanning the table", async () => {
    const plan = await db.all<{ detail: string }>(
      sql`explain query plan select * from tickets where opened_by = 'emp-ana' and category = 'hardware' and status <> 'resolved' order by created_at desc`,
    );
    expect(plan.map((step) => step.detail).join(" | ")).toContain("USING INDEX tickets_opened_by_created_at_idx");
  });
});

describe("PATCH /tickets/:id (follow-up of the employee)", () => {
  it("adds the information as an update of the employee and answers the ticket", async () => {
    const response = await followUp("INC-20311");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "INC-20311", status: "waiting_for_analyst" });
    expect(await updatesOf("INC-20311")).toEqual([{ author: "employee", text: "Agora trava também ao abrir o Teams." }]);
  });

  it("restarts neither the deadline nor the last update, which are the ones of IT (RN-02)", async () => {
    const before = await row("INC-20311");
    clock = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    await followUp("INC-20311");
    const after = await row("INC-20311");
    expect(after.dueAt).toEqual(before.dueAt);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.lastItResponseAt).toEqual(before.lastItResponseAt);
  });

  it("adds it once when the same draft is confirmed again, and answers the same", async () => {
    const first = await (await followUp("INC-20311")).json();
    const again = await followUp("INC-20311");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(await updatesOf("INC-20311")).toHaveLength(1);
  });

  it("answers the same 404 for a ticket of somebody else and for one that does not exist, and writes nothing", async () => {
    const theirs = await followUp("INC-20319");
    const missing = await followUp("INC-99999");
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(error("ticket_not_found", "Ticket not found"));
    expect(await missing.json()).toEqual(error("ticket_not_found", "Ticket not found"));
    expect(await updatesOf("INC-20319")).toEqual([]);
  });

  it("refuses a resolved ticket, which is reopened instead", async () => {
    const response = await followUp("INC-20150");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(error("ticket_resolved", "The ticket is resolved"));
  });

  it("needs the idempotency key, the employee and a text", async () => {
    expect((await write("PATCH", "/tickets/INC-20311", { employeeId: "emp-ana", text: "Oi" })).status).toBe(400);
    expect((await followUp("INC-20311", { text: "Oi" })).status).toBe(400);
    expect((await followUp("INC-20311", { employeeId: "emp-ana", text: " " })).status).toBe(400);
    expect((await followUp("drop-table")).status).toBe(400);
  });
});

describe("POST /tickets/:id/reopen", () => {
  it("reopens a ticket resolved 4 days ago: waiting for an analyst again, with what happened as an update", async () => {
    const response = await reopen("INC-20150");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "INC-20150",
      status: "waiting_for_analyst",
      assignedTo: null,
      resolvedAt: null,
      updatedAt: start.toISOString(),
    });
    expect((await updatesOf("INC-20150")).at(-1)).toEqual({ author: "employee", text: "A senha bloqueou de novo hoje cedo." });
  });

  it("restarts the deadline from the reopening, which counts as a new opening", async () => {
    const reopened = (await (await reopen("INC-20150")).json()) as Ticket;
    // Medium: 3 business days from Monday 10:00 is Thursday 10:00 in São Paulo.
    expect(reopened.dueAt).toBe("2026-10-29T13:00:00.000Z");
  });

  it("refuses a ticket resolved more than 7 days ago, and changes nothing", async () => {
    // INC-19877 was resolved 12 days ago.
    const response = await reopen("INC-19877");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(error("reopen_window_closed", "The ticket was resolved more than 7 days ago"));
    expect((await row("INC-19877")).status).toBe("resolved");
  });

  it("reopens on the seventh day and refuses on the eighth", async () => {
    // INC-20150 was resolved 4 days ago: 3 more days is the seventh, 4 more the eighth.
    clock = new Date(start.getTime() + 3 * DAY + 10 * 60 * 60 * 1000);
    expect((await reopen("INC-20150", undefined, "draft-a")).status).toBe(200);
    await seed(db, start);
    clock = new Date(start.getTime() + 4 * DAY);
    expect((await reopen("INC-20150", undefined, "draft-b")).status).toBe(409);
  });

  it("refuses a ticket that is not resolved", async () => {
    const response = await reopen("INC-20311");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(error("ticket_not_resolved", "The ticket is not resolved"));
  });

  it("answers 404 for a ticket of somebody else", async () => {
    expect((await reopen("INC-20319")).status).toBe(404);
  });

  it("reopens once when the same draft is confirmed again", async () => {
    const first = await (await reopen("INC-20150")).json();
    const again = await reopen("INC-20150");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect((await updatesOf("INC-20150")).filter((update) => update.author === "employee")).toHaveLength(1);
  });

  it("needs the idempotency key", async () => {
    expect((await write("POST", "/tickets/INC-20150/reopen", { employeeId: "emp-ana", text: "De novo." })).status).toBe(400);
  });

  it("answers the reopening to a retry that arrives while the first one is still being written, never a refusal", async () => {
    // The order of the race, played step by step: the retry checks the key, finds nothing, and the first request
    // commits the reopening before the retry's transaction starts. The ticket is no longer resolved by then.
    const body = { employeeId: "emp-ana", text: "De novo." };
    let first: Response | undefined;
    const racing = new Proxy(db, {
      get(target, property) {
        if (property === "transaction") {
          return async (...args: Parameters<Db["transaction"]>) => {
            first ??= await write("POST", "/tickets/INC-20150/reopen", body, "draft-same");
            return target.transaction(...args);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const retry = await createApp({ db: racing, serviceSecret: SECRET, adminKey: "admin", outageRate: 0, now: () => clock, random: () => 0.99 })
      .request("/tickets/INC-20150/reopen", {
        method: "POST",
        headers: { [SERVICE_SECRET_HEADER]: SECRET, "content-type": "application/json", [IDEMPOTENCY_KEY_HEADER]: "draft-same" },
        body: JSON.stringify(body),
      });
    expect(first?.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first!.json());
    expect((await updatesOf("INC-20150")).filter((update) => update.author === "employee")).toHaveLength(1);
  });
});

describe("idempotency across the writes", () => {
  it("refuses a key already used for another write, without doing either twice", async () => {
    await followUp("INC-20311", undefined, "draft-1");
    const reused = await reopen("INC-20150", undefined, "draft-1");
    expect(reused.status).toBe(422);
    expect(await reused.json()).toEqual(error("idempotency_key_reused", "The key was used for another request"));
    expect((await row("INC-20150")).status).toBe("resolved");
  });

  it("never answers one employee with what another one wrote under the same key", async () => {
    await followUp("INC-20311", undefined, "draft-1");
    const other = await followUp("INC-20311", { employeeId: "emp-diego", text: "Oi" }, "draft-1");
    expect(other.status).toBe(422);
    expect(JSON.stringify(await other.json())).not.toContain("INC-20311");
  });

  it("never answers a ticket created by another employee under the same key", async () => {
    const body = (employeeId: string) => ({
      employeeId,
      type: "INC",
      title: "VPN",
      description: "Erro 809.",
      category: "network_vpn",
      subcategory: null,
      priority: "high",
      affected: "only_me",
    });
    expect((await write("POST", "/tickets", body("emp-ana"), "draft-1")).status).toBe(201);
    expect((await write("POST", "/tickets", body("emp-diego"), "draft-1")).status).toBe(422);
  });

  it("refuses the key of a follow-up sent to another ticket", async () => {
    await followUp("INC-20311", undefined, "draft-1");
    expect((await followUp("INC-20298", undefined, "draft-1")).status).toBe(422);
  });

  it("saves the follow-up when an outage falls before the answer; the retry gets it, added once", async () => {
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

    const result = await client.addFollowUp("INC-20311", { employeeId: "emp-ana", text: "Trava no Teams." }, "draft-7");

    expect(result.ok && result.data.id).toBe("INC-20311");
    expect(await updatesOf("INC-20311")).toEqual([{ author: "employee", text: "Trava no Teams." }]);
  });

  it("shows the follow-up in the detail of the ticket, after the updates of IT", async () => {
    await followUp("REQ-10442");
    const detail = (await (await get("/tickets/REQ-10442?employeeId=emp-ana")).json()) as TicketDetail;
    expect(detail.updates.map((update) => update.author)).toEqual(["analyst", "employee"]);
  });
});
