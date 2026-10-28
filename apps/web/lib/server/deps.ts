import { createTicketServiceClient, type TicketServiceClient } from "@nexo/shared";
import { z } from "zod";
import { createDb, type Db } from "@/db";
import { sessionSecret } from "./session";

/** What the server code needs from the outside. Route handlers get the real one; tests build their own. */
export type Deps = {
  db: Db;
  ticketService: Pick<TicketServiceClient, "findEmployeeByEmail" | "listAnalysts">;
  sessionSecret: string;
  secureCookies: boolean;
  now: () => Date;
};

const env = z.object({
  CONVERSATIONS_DB_URL: z.string().min(1).default("file:conversations.db"),
  CONVERSATIONS_DB_AUTH_TOKEN: z.string().optional(),
  TICKET_SERVICE_URL: z.url(),
  TICKET_SERVICE_SECRET: z.string().min(1),
  SESSION_SECRET: sessionSecret,
});

let deps: Deps | undefined;

/** Built once per server instance, on first use, so a missing variable fails loudly at the first request. */
export function getDeps(): Deps {
  if (!deps) {
    const config = env.parse(process.env);
    deps = {
      db: createDb(config.CONVERSATIONS_DB_URL, config.CONVERSATIONS_DB_AUTH_TOKEN),
      ticketService: createTicketServiceClient({ baseUrl: config.TICKET_SERVICE_URL, secret: config.TICKET_SERVICE_SECRET }),
      sessionSecret: config.SESSION_SECRET,
      secureCookies: process.env.NODE_ENV === "production",
      now: () => new Date(),
    };
  }
  return deps;
}
