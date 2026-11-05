import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDay } from "@nexo/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db";
import { migrateDb } from "@/db/migrate";
import { usageCounters } from "@/db/schema";
import { env } from "./deps";
import { NOW, request } from "./test-deps";
import { claimModelCall, clientIp, type ModelCall, releaseModelCall } from "./usage";

const DAY = localDay(NOW);
const VISITOR = `ip:1.1.1.1:${DAY}`;
const EVERYONE = `global:${DAY}`;
const NEXT_DAY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

async function emptyDb() {
  const db = createDb(":memory:");
  await migrateDb(db);
  return db;
}

async function fileDb() {
  const url = `file:${join(mkdtempSync(join(tmpdir(), "nexo-usage-")), "conversations.db")}`;
  const db = createDb(url);
  await migrateDb(db);
  return { url, db };
}

async function countOf(db: Db, key: string) {
  const [row] = await db.select({ count: usageCounters.count }).from(usageCounters).where(eq(usageCounters.key, key));
  return row?.count ?? 0;
}

const limited = (db: Db, { perIp = 100, global = 100, now = NOW }: { perIp?: number; global?: number; now?: Date } = {}) => ({
  db,
  usageLimits: { perIp, global },
  now: () => now,
});

const granted = (call: ModelCall) => call.outcome === "granted";

/** Claims the message and gives the call back, as a reply that failed does. */
async function failedCall(db: Db, messageId: string, options: Parameters<typeof limited>[1] = {}) {
  const call = await claimModelCall(limited(db, options), { messageId, ip: "1.1.1.1" });
  if (call.outcome !== "granted") throw new Error(`Expected the call to be granted, got ${call.outcome}`);
  await releaseModelCall(db, call.key);
}

describe("claimModelCall", () => {
  it("counts a message under the ceilings for its IP and for everyone", async () => {
    const db = await emptyDb();
    expect(granted(await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);
    expect(granted(await claimModelCall(limited(db), { messageId: "m2", ip: "2.2.2.2" }))).toBe(true);
    expect(await countOf(db, VISITOR)).toBe(1);
    expect(await countOf(db, `ip:2.2.2.2:${DAY}`)).toBe(1);
    expect(await countOf(db, EVERYONE)).toBe(2);
  });

  it("refuses past the ceiling of the IP, without moving any counter, and lets another IP through", async () => {
    const db = await emptyDb();
    const deps = limited(db, { perIp: 2 });
    await claimModelCall(deps, { messageId: "m1", ip: "1.1.1.1" });
    await claimModelCall(deps, { messageId: "m2", ip: "1.1.1.1" });
    expect(await claimModelCall(deps, { messageId: "m3", ip: "1.1.1.1" })).toEqual({ outcome: "over_ceiling" });
    expect(await countOf(db, VISITOR)).toBe(2);
    expect(await countOf(db, EVERYONE)).toBe(2);
    expect(granted(await claimModelCall(deps, { messageId: "m4", ip: "2.2.2.2" }))).toBe(true);
  });

  it("refuses everyone past the global ceiling, without moving the count of the new IP", async () => {
    const db = await emptyDb();
    const deps = limited(db, { global: 2 });
    await claimModelCall(deps, { messageId: "m1", ip: "1.1.1.1" });
    await claimModelCall(deps, { messageId: "m2", ip: "2.2.2.2" });
    expect(await claimModelCall(deps, { messageId: "m3", ip: "3.3.3.3" })).toEqual({ outcome: "over_ceiling" });
    expect(await countOf(db, `ip:3.3.3.3:${DAY}`)).toBe(0);
    expect(await countOf(db, EVERYONE)).toBe(2);
  });

  it("counts a refused message once, when it comes back and there is room", async () => {
    const db = await emptyDb();
    await claimModelCall(limited(db, { perIp: 1 }), { messageId: "m1", ip: "1.1.1.1" });
    expect(await claimModelCall(limited(db, { perIp: 1 }), { messageId: "m2", ip: "1.1.1.1" })).toEqual({ outcome: "over_ceiling" });
    expect(await claimModelCall(limited(db, { perIp: 1 }), { messageId: "m2", ip: "1.1.1.1" })).toEqual({ outcome: "over_ceiling" });
    expect(await countOf(db, VISITOR)).toBe(1);

    expect(granted(await claimModelCall(limited(db, { perIp: 2 }), { messageId: "m2", ip: "1.1.1.1" }))).toBe(true);
    expect(await countOf(db, VISITOR)).toBe(2);
  });

  it("starts the day over at midnight in São Paulo, not in UTC", async () => {
    const db = await emptyDb();
    const deps = (now: string) => limited(db, { perIp: 1, global: 1, now: new Date(now) });
    expect(granted(await claimModelCall(deps("2026-10-26T14:00:00Z"), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);
    // 23:59 of the 26th in São Paulo, already the 27th in UTC.
    expect((await claimModelCall(deps("2026-10-27T02:59:00Z"), { messageId: "m2", ip: "1.1.1.1" })).outcome).toBe("over_ceiling");
    expect(granted(await claimModelCall(deps("2026-10-27T03:00:00Z"), { messageId: "m3", ip: "1.1.1.1" }))).toBe(true);
  });
});

describe("claimModelCall with a message that comes back", () => {
  it("refuses a repeat while the call runs or after it ended, without counting", async () => {
    const db = await emptyDb();
    expect(granted(await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);
    expect(await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" })).toEqual({ outcome: "repeat" });
    expect(await claimModelCall(limited(db), { messageId: "m1", ip: "2.2.2.2" })).toEqual({ outcome: "repeat" });
    expect(await countOf(db, EVERYONE)).toBe(1);
    expect(await countOf(db, VISITOR)).toBe(1);
  });

  it("lets a message try again after a reply that failed, without counting, even with the day used up", async () => {
    const db = await emptyDb();
    await failedCall(db, "m1", { perIp: 1, global: 1 });
    expect(granted(await claimModelCall(limited(db, { perIp: 1, global: 1 }), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);
    expect(await countOf(db, EVERYONE)).toBe(1);
    expect(await countOf(db, VISITOR)).toBe(1);
  });

  it("gives one retry to one of two turns at once after a reply that failed", async () => {
    const db = await emptyDb();
    await failedCall(db, "m1");
    const turns = await Promise.all([1, 2, 3, 4].map(() => claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" })));
    expect(turns.filter(granted)).toHaveLength(1);
    expect(turns.filter(({ outcome }) => outcome === "repeat")).toHaveLength(3);
  });

  it("stops after three calls that failed, in the same day", async () => {
    const db = await emptyDb();
    await failedCall(db, "m1");
    await failedCall(db, "m1");
    await failedCall(db, "m1");
    expect(await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" })).toEqual({ outcome: "repeat" });
    expect(await countOf(db, `message:${DAY}:m1`)).toBe(-3);
    expect(await countOf(db, EVERYONE)).toBe(1);
  });

  it("releases only a call that is running: releasing twice gives no extra retry", async () => {
    const db = await emptyDb();
    const call = await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" });
    if (call.outcome !== "granted") throw new Error("Expected the call to be granted");
    await releaseModelCall(db, call.key);
    await releaseModelCall(db, call.key);
    expect(await countOf(db, call.key)).toBe(-1);
  });

  it("takes a failed message on the next day as a new one, on the ceilings of that day", async () => {
    const db = await emptyDb();
    await failedCall(db, "m1");

    expect(granted(await claimModelCall(limited(db, { now: NEXT_DAY }), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);

    expect(await countOf(db, `global:${DAY + 1}`)).toBe(1);
    expect(await countOf(db, `ip:1.1.1.1:${DAY + 1}`)).toBe(1);
    expect(await countOf(db, `message:${DAY + 1}:m1`)).toBe(1);
  });

  it("carries no pass into the next day: a failed message is held there by its ceilings", async () => {
    const db = await emptyDb();
    await failedCall(db, "m1");
    await db.insert(usageCounters).values({ key: `global:${DAY + 1}`, count: 5 });

    expect(await claimModelCall(limited(db, { global: 5, now: NEXT_DAY }), { messageId: "m1", ip: "1.1.1.1" })).toEqual({ outcome: "over_ceiling" });
  });

  it("keeps a call with no known end refused that day only: the next day it is a new one, on that day's ceilings", async () => {
    const db = await emptyDb();
    expect(granted(await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);
    expect(await claimModelCall(limited(db), { messageId: "m1", ip: "1.1.1.1" })).toEqual({ outcome: "repeat" });

    expect(granted(await claimModelCall(limited(db, { now: NEXT_DAY }), { messageId: "m1", ip: "1.1.1.1" }))).toBe(true);
    expect(await countOf(db, `global:${DAY + 1}`)).toBe(1);
  });
});

describe("claimModelCall under concurrency", () => {
  it("loses no count and passes no ceiling with messages at once from two clients of a file", async () => {
    const { url, db: one } = await fileDb();
    const other = createDb(url);
    const claim = (db: Db, index: number) => claimModelCall(limited(db, { perIp: 15, global: 20 }), { messageId: `m${index}`, ip: `1.1.1.${index % 2}` });

    const answers = await Promise.all(Array.from({ length: 60 }, (_, index) => claim(index % 2 ? one : other, index)));

    expect(answers.filter(granted)).toHaveLength(20);
    expect(await countOf(one, EVERYONE)).toBe(20);
  }, 30_000);
});

describe("clientIp", () => {
  const withHeaders = (entries: Record<string, string>) => {
    const incoming = request("/api/chat");
    for (const [name, value] of Object.entries(entries)) incoming.headers.set(name, value);
    return incoming;
  };

  it("reads the client, the first of the list Vercel writes", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "200.1.2.3, 10.0.0.1" }))).toBe("200.1.2.3");
  });

  it("falls back to the other header, and to one visitor in a local run", () => {
    expect(clientIp(withHeaders({ "x-real-ip": "200.1.2.3" }))).toBe("200.1.2.3");
    expect(clientIp(withHeaders({}))).toBe("local");
    expect(clientIp(withHeaders({ "x-forwarded-for": " " }))).toBe("local");
  });
});

describe("the ceilings in the environment", () => {
  const required = { TICKET_SERVICE_URL: "http://tickets.test", TICKET_SERVICE_SECRET: "s" };

  it("have defaults, and take the values given", () => {
    expect(env.parse(required)).toMatchObject({ USAGE_LIMIT_PER_IP_PER_DAY: 300, USAGE_LIMIT_GLOBAL_PER_DAY: 1000 });
    expect(env.parse({ ...required, USAGE_LIMIT_PER_IP_PER_DAY: "5", USAGE_LIMIT_GLOBAL_PER_DAY: "9" })).toMatchObject({
      USAGE_LIMIT_PER_IP_PER_DAY: 5,
      USAGE_LIMIT_GLOBAL_PER_DAY: 9,
    });
  });

  it("fail loudly rather than turn the demo off by accident", () => {
    expect(env.safeParse({ ...required, USAGE_LIMIT_PER_IP_PER_DAY: "" }).success).toBe(false);
    expect(env.safeParse({ ...required, USAGE_LIMIT_GLOBAL_PER_DAY: "muitos" }).success).toBe(false);
    expect(env.safeParse({ ...required, USAGE_LIMIT_GLOBAL_PER_DAY: "0" }).success).toBe(false);
  });
});
