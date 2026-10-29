import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import type { MastraModelConfig } from "@mastra/core/llm";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { instructions, workingMemoryTemplate } from "./instructions";
import { createTools, OFFER_TOOLS, type TicketDesk } from "./tools";

// Explicit limits, so one reply never runs away with time or cost (ARQUITETURA.md, section 9).
const MAX_STEPS = 5;
const MAX_OUTPUT_TOKENS = 800;
const TOTAL_TIMEOUT_MS = 45_000;
const LAST_MESSAGES = 20;

/** The agent's memory lives in the conversations database, in the mastra_* tables. */
export function createMemory({ url, authToken }: { url: string; authToken?: string }) {
  return new Memory({
    storage: new LibSQLStore({ id: "nexo-memory", url, authToken: authToken || undefined }),
    options: {
      lastMessages: LAST_MESSAGES,
      workingMemory: { enabled: true, scope: "thread", template: workingMemoryTemplate },
      generateTitle: false,
    },
  });
}

/** Any model Mastra takes: a "provider/model" id, or a model object such as the simulated one. */
export type AgentModel = MastraModelConfig;

export function createNexoAgent({
  model,
  memory,
  ticketService,
  now = () => new Date(),
}: {
  model: AgentModel;
  memory: Memory;
  ticketService: TicketDesk;
  /** The clock of the overdue (RN-02) and of "há N dias". */
  now?: () => Date;
}) {
  return new Agent({
    id: "nexo-assist",
    name: "Nexo Assist",
    // The tools and these instructions are the same on every call (about 2.8 thousand tokens): cached, the second
    // and third steps of a reply, and every later reply within five minutes, read them at a tenth of the price.
    instructions: {
      role: "system",
      content: instructions,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    model,
    memory,
    tools: createTools({ ticketService, now }),
  });
}

export type NexoAgent = ReturnType<typeof createNexoAgent>;

export type Turn = {
  /** The Mastra thread: one per conversation. */
  conversationId: string;
  /** The Mastra resource, from the session, never from the model. */
  employeeId: string;
  text: string;
};

/** One reply of the agent: the Mastra stream, which the route turns into the chat stream and saves at the end. */
export function streamReply(agent: NexoAgent, { conversationId, employeeId, text }: Turn) {
  return agent.stream(text, {
    memory: { thread: conversationId, resource: employeeId },
    // Whose tickets the tools read: the employee of the session, never a value the model writes.
    requestContext: new RequestContext([["employeeId", employeeId]]),
    maxSteps: MAX_STEPS,
    // An offer hands the turn to the employee, who answers with a click: calling the model again would only cost.
    stopWhen: ({ steps }: { steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string }> }> }) =>
      steps.at(-1)?.toolCalls.some((call) => OFFER_TOOLS.has(call.toolName)) ?? false,
    // recordDecision is mandatory in the first step; afterwards the model chooses.
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "recordDecision" } } : undefined,
    modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeout: { totalMs: TOTAL_TIMEOUT_MS } },
  });
}
