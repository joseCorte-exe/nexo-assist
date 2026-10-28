import { createApp } from "./app";
import { createDb } from "./db";

// Entry point. Vercel serves this default export; locally server.ts wraps it.
export default createApp({
  db: createDb(process.env.TICKETS_DB_URL ?? "file:tickets.db", process.env.TICKETS_DB_AUTH_TOKEN),
  serviceSecret: process.env.TICKET_SERVICE_SECRET ?? "",
  adminKey: process.env.ADMIN_KEY ?? "",
  outageRate: Number(process.env.OUTAGE_RATE ?? 0),
  now: () => new Date(),
  random: Math.random,
});
