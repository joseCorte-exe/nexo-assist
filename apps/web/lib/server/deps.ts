import { AGENT_MODEL, type AgentMemory, createMemory, createNexoAgent, type NexoAgent, simulatedModel } from "@nexo/agent";
import { createTicketServiceClient, type TicketServiceClient } from "@nexo/shared";
import { after } from "next/server";
import { z } from "zod";
import { createDb, type Db } from "@/db";
import { createDraftStore } from "./drafts";
import { getSessionSecret } from "./session";

/** What the server code needs from the outside. Route handlers get the real one; tests build their own. */
export type Deps = {
  db: Db;
  ticketService: Pick<
    TicketServiceClient,
    "findPersonByEmail" | "listAnalysts" | "createTicket" | "addFollowUp" | "reopenTicket" | "listCandidates"
  >;
  agent: NexoAgent;
  /** The agent memory, for the notes of what the employee did outside the agent. */
  memory: Pick<AgentMemory, "saveMessages">;
  /** Keeps the server running for work that ends after the response, like saving the agent reply. */
  waitUntil: (task: Promise<unknown>) => void;
  sessionSecret: string;
  secureCookies: boolean;
  now: () => Date;
};

const env = z.object({
  CONVERSATIONS_DB_URL: z.string().min(1).default("file:conversations.db"),
  CONVERSATIONS_DB_AUTH_TOKEN: z.string().optional(),
  TICKET_SERVICE_URL: z.url(),
  TICKET_SERVICE_SECRET: z.string().min(1),
  /** "simulated" swaps the LLM for fixed rules: the end-to-end tests, or running without an API key. */
  NEXO_AGENT_MODEL: z.enum(["claude", "simulated"]).default("claude"),
});

// The simulated reply arrives word by word, a little slower than a person reads, like the real model.
const SIMULATED_WORD_DELAY_MS = 35;

let deps: Deps | undefined;

/** Built once per server instance, on first use, so a missing variable fails loudly at the first request. */
export function getDeps(): Deps {
  if (!deps) {
    const config = env.parse(process.env);
    const ticketService = createTicketServiceClient({
      baseUrl: config.TICKET_SERVICE_URL,
      secret: config.TICKET_SERVICE_SECRET,
    });
    const db = createDb(config.CONVERSATIONS_DB_URL, config.CONVERSATIONS_DB_AUTH_TOKEN);
    // Same database as the conversations: the memory goes in the mastra_* tables.
    const memory = createMemory({ url: config.CONVERSATIONS_DB_URL, authToken: config.CONVERSATIONS_DB_AUTH_TOKEN });
    deps = {
      db,
      ticketService,
      agent: createNexoAgent({
        model:
          config.NEXO_AGENT_MODEL === "simulated" ? simulatedModel({ delayMs: SIMULATED_WORD_DELAY_MS }) : AGENT_MODEL,
        memory,
        ticketService,
        drafts: createDraftStore(db),
      }),
      memory,
      waitUntil: (task) => after(task),
      sessionSecret: getSessionSecret(),
      secureCookies: process.env.NODE_ENV === "production",
      now: () => new Date(),
    };
  }
  return deps;
}
