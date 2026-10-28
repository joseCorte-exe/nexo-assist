import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "./app";
import { errorBody } from "./errors";
import type { Db } from "./db";
import { serviceState } from "./db/schema";

const MIN_WINDOW_SECONDS = 1;
const MAX_WINDOW_SECONDS = 4;

const unavailable = () =>
  Response.json(errorBody("unavailable", "Ticket service is temporarily unavailable"), { status: 503 });

/**
 * Simulates the legacy system going down for a few seconds now and then.
 * The window lives in the database so it holds across serverless instances.
 * Admin routes never go down, so an outage can always be forced or reset.
 */
export function outage(deps: Deps): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path.startsWith("/admin")) return next();

    const now = deps.now();
    const until = await unavailableUntil(deps.db);
    if (until && until > now) return unavailable();

    if (deps.random() >= deps.outageRate) return next();

    const seconds = MIN_WINDOW_SECONDS + Math.floor(deps.random() * (MAX_WINDOW_SECONDS - MIN_WINDOW_SECONDS + 1));
    await openOutageWindow(deps.db, now, seconds);

    // Half of the outages that hit a ticket creation save the ticket and fall before answering.
    // The client's retry with the same idempotency key then gets the saved ticket back.
    const isCreate = c.req.method === "POST" && c.req.path === "/tickets";
    if (isCreate && deps.random() < 0.5) {
      await next();
      c.res = unavailable();
      return;
    }
    return unavailable();
  };
}

async function unavailableUntil(db: Db) {
  const [state] = await db.select().from(serviceState).where(eq(serviceState.id, 1));
  return state?.unavailableUntil ?? null;
}

export async function openOutageWindow(db: Db, now: Date, seconds: number) {
  const unavailableUntil = new Date(now.getTime() + seconds * 1000);
  await db
    .insert(serviceState)
    .values({ id: 1, unavailableUntil })
    .onConflictDoUpdate({ target: serviceState.id, set: { unavailableUntil } });
  return unavailableUntil;
}
