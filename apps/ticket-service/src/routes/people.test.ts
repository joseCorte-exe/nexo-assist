import { type Analyst, type Employee, SERVICE_SECRET_HEADER } from "@nexo/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createDb, type Db } from "../db";
import { migrateDb } from "../db/migrate";
import { seed } from "../seed";

const SECRET = "service-secret";
const clock = new Date("2026-10-26T13:00:00Z");

let app: ReturnType<typeof createApp>;
let db: Db;

beforeEach(async () => {
  db = createDb(":memory:");
  await migrateDb(db);
  await seed(db, clock);
  app = createApp({ db, serviceSecret: SECRET, adminKey: "admin", outageRate: 0, now: () => clock, random: () => 0.99 });
});

const get = (path: string, secret = SECRET) => app.request(path, { headers: { [SERVICE_SECRET_HEADER]: secret } });

describe("GET /employees?email=", () => {
  it("returns the employee with that e-mail, with the password date relative to the seed", async () => {
    const response = await get("/employees?email=ana.souza%40nexo.com.br");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "emp-ana",
        name: "Ana Souza",
        email: "ana.souza@nexo.com.br",
        department: "Financeiro",
        // 42 days before the seed, as the profile screen of the design shows.
        passwordChangedAt: "2026-09-14T13:00:00.000Z",
      },
    ]);
  });

  it("ignores case and surrounding spaces", async () => {
    const response = await get(`/employees?email=${encodeURIComponent("  Ana.Souza@NEXO.com.br ")}`);
    const found = (await response.json()) as Employee[];
    expect(found.map((employee) => employee.id)).toEqual(["emp-ana"]);
  });

  it("returns an empty list for an unknown e-mail", async () => {
    const response = await get("/employees?email=ninguem%40nexo.com.br");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("rejects a missing or invalid e-mail", async () => {
    expect((await get("/employees")).status).toBe(400);
    expect((await get("/employees?email=ana")).status).toBe(400);
  });

  it("needs the service secret", async () => {
    expect((await get("/employees?email=ana.souza%40nexo.com.br", "wrong")).status).toBe(401);
  });
});

describe("GET /analysts", () => {
  it("returns every analyst with level and availability", async () => {
    const response = await get("/analysts");
    expect(response.status).toBe(200);
    const analysts = (await response.json()) as Analyst[];
    expect(analysts).toContainEqual({
      id: "analyst-rafael",
      name: "Rafael Lima",
      email: "rafael.lima@nexo.com.br",
      level: "N2",
      available: true,
    });
    expect(analysts.map((analyst) => analyst.level)).toContain("N1");
  });
});
