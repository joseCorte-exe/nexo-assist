import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import type { StoredDecision } from "@nexo/shared";
import { instructions, workingMemoryTemplate } from "./instructions";
import { createTools, type HelpCenter } from "./tools";
import { summarizeTurn } from "./turn-summary";

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
  helpCenter,
}: {
  model: AgentModel;
  memory: Memory;
  helpCenter: HelpCenter;
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
    tools: createTools({ helpCenter }),
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

export type TurnResult = { ok: true; text: string; decision: StoredDecision } | { ok: false; error: unknown };

/**
 * One reply of the agent. `output` is the stream for the screen; `finished` resolves when the reply is over,
 * with the text and the decision to save, and never rejects.
 */
export function streamReply(agent: NexoAgent, { conversationId, employeeId, text }: Turn) {
  const output = agent.stream(text, {
    memory: { thread: conversationId, resource: employeeId },
    maxSteps: MAX_STEPS,
    // recordDecision is mandatory in the first step; afterwards the model chooses.
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "recordDecision" } } : undefined,
    modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeout: { totalMs: TOTAL_TIMEOUT_MS } },
  });

  const finished: Promise<TurnResult> = output
    .then((stream) => stream.getFullOutput())
    .then((full): TurnResult => {
      if (full.error) return { ok: false, error: full.error };
      const toolCalls = full.steps.flatMap((step) =>
        step.toolCalls.map(({ payload }) => ({ toolName: payload.toolName, args: payload.args })),
      );
      return { ok: true, text: full.text, decision: summarizeTurn(toolCalls) };
    })
    .catch((error: unknown) => ({ ok: false, error }));

  return { output, finished };
}
