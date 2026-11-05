import { localDay } from "@nexo/shared";
import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type { Db } from "@/db";
import { usageCounters } from "@/db/schema";
import type { Deps } from "./deps";

// The ceilings against abuse in the deploy (ARQUITETURA.md, section 9): how many messages may call the model per IP and
// in all, per São Paulo day. Only a message about to call the model comes here: the polling and a message for an analyst
// never do (section 7).

/** How many messages may call the model in a São Paulo day. */
export type UsageLimits = { perIp: number; global: number };

/** granted: call the model, and give the key back if the reply fails. repeat: this message may not call it again now. */
export type ModelCall = { outcome: "granted"; key: string } | { outcome: "over_ceiling" } | { outcome: "repeat" };

/** The calls one message may make in a day: the first, and two more after replies that failed. */
const MAX_CALLS_PER_MESSAGE = 3;

/** Where the request came from. In a local run with neither header, every message counts as the same visitor. */
export function clientIp({ headers }: Pick<NextRequest, "headers">): string {
  // Trusted because Vercel overwrites these headers, so a client cannot forge them there; off Vercel the global ceiling still caps cost.
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "local";
}

/**
 * Whether this message may call the model, counting it if it may. One statement moves both counters or neither, so no
 * two requests at once, on any server, read the same count and pass the ceiling together.
 *
 * A message that passes keeps a row of that day, whose count is the calls it made: positive while a call runs or after
 * it ended, so a repeat is refused and two turns never call the model for one message. Only a reply that failed turns it
 * negative (releaseModelCall), which lets the same message try again, without counting on the ceilings, up to
 * MAX_CALLS_PER_MESSAGE. A process that died leaves it positive: nobody knows whether the model ran, so it is not repeated
 * that day.
 *
 * The next day the row no longer counts, and a message that comes back goes through the ceilings like a new one. A reply
 * saved is refused before this, on any day (chat.ts, startTurn). A message refused by a ceiling has no row: it is looked
 * at again if it comes back, and counts only then.
 */
export async function claimModelCall(
  { db, usageLimits, now }: Pick<Deps, "db" | "usageLimits" | "now">,
  { messageId, ip }: { messageId: string; ip: string },
): Promise<ModelCall> {
  const day = localDay(now());
  const key = `message:${day}:${messageId}`;
  const visitor = `ip:${ip}:${day}`;
  const everyone = `global:${day}`;
  const used = (counter: string) => sql`coalesce((select count from ${usageCounters} where "key" = ${counter}), 0)`;
  const [retried, counted, rows] = await db.batch([
    db.run(sql`update ${usageCounters} set count = 1 - count where "key" = ${key} and count < 0 and count > ${-MAX_CALLS_PER_MESSAGE}`),
    db.run(sql`
      insert into ${usageCounters} ("key", count)
      select column1, 1 from (values (${key}), (${visitor}), (${everyone}))
      where not exists (select 1 from ${usageCounters} where "key" = ${key})
        and ${used(visitor)} < ${usageLimits.perIp}
        and ${used(everyone)} < ${usageLimits.global}
      on conflict ("key") do update set count = count + 1`),
    db.select({ key: usageCounters.key }).from(usageCounters).where(eq(usageCounters.key, key)),
  ]);
  if (retried.rowsAffected > 0 || counted.rowsAffected > 0) return { outcome: "granted", key };
  return { outcome: rows.length > 0 ? "repeat" : "over_ceiling" };
}

/** The reply of this call failed: the message may try again. */
export async function releaseModelCall(db: Db, key: string) {
  await db.run(sql`update ${usageCounters} set count = -count where "key" = ${key} and count > 0`);
}
