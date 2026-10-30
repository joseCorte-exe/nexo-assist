import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import type { MastraModelConfig } from "@mastra/core/llm";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { instructions, workingMemoryTemplate } from "./instructions";
import { createTools, type DraftStore, OFFER_TOOLS, type TicketDesk } from "./tools";

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

export type AgentMemory = ReturnType<typeof createMemory>;

/** Prefix of the notes of what happened on the screen, which the instructions tell the model how to read. */
export const SCREEN_NOTE = "(ação na tela)";

/**
 * Copies to the conversation's memory something the employee did outside the agent (confirmed, edited or cancelled a
 * draft), so the model knows it next turn. It goes in as her message: Mastra leaves system messages out of what the
 * model reads. The same id saved again replaces the note instead of repeating it.
 */
export async function saveNote(
  memory: Pick<AgentMemory, "saveMessages">,
  { id, conversationId, employeeId, text, at }: { id: string; conversationId: string; employeeId: string; text: string; at: Date },
) {
  await memory.saveMessages({
    messages: [
      {
        id,
        role: "user",
        createdAt: at,
        threadId: conversationId,
        resourceId: employeeId,
        content: { format: 2, parts: [{ type: "text", text: `${SCREEN_NOTE} ${text}` }] },
      },
    ],
  });
}

/** Any model Mastra takes: a "provider/model" id, or a model object such as the simulated one. */
export type AgentModel = MastraModelConfig;

export function createNexoAgent({
  model,
  memory,
  ticketService,
  drafts,
  now = () => new Date(),
}: {
  model: AgentModel;
  memory: Memory;
  ticketService: TicketDesk;
  /** Where draftTicket keeps the drafts: the conversations database. */
  drafts: DraftStore;
  /** The clock of the overdue (RN-02) and of "há N dias". */
  now?: () => Date;
}) {
  return new Agent({
    id: "nexo-assist",
    name: "Nexo Assist",
    // The tools and these instructions are the same on every call (3.5 thousand tokens, measured on Haiku 5.5):
    // cached, the next steps of a reply, and every later reply within five minutes, read them at a tenth of the price.
    instructions: {
      role: "system",
      content: instructions,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    model,
    memory,
    tools: createTools({ ticketService, drafts, now }),
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

type ToolResult = { toolName: string; output?: unknown };
type Step = { text: string; toolResults: ReadonlyArray<ToolResult> };

/** The Mastra tool the model calls to keep the summary of the case (the working memory). */
const WORKING_MEMORY_TOOL = "updateWorkingMemory";

/** A tool that ran and answered ok. The model gets the output wrapped as { type: "json", value }. */
function answeredOk({ output }: ToolResult) {
  const wrapped = output as { type?: string; value?: { ok?: unknown } } | undefined;
  return wrapped?.type === "json" && wrapped.value?.ok === true;
}

/**
 * The reply is done: an offer was shown; or the model answered and, along with it, only updated the working memory or
 * showed the draft, which the screen draws under the answer. Called again after that, the model writes the same answer
 * a second time. A draft shown without text goes on: the model still says what it decided, above the card.
 */
function replyDone(step: Step | undefined) {
  if (!step) return false;
  if (step.toolResults.some((result) => OFFER_TOOLS.has(result.toolName) && answeredOk(result))) return true;
  return (
    step.text.trim() !== "" &&
    step.toolResults.every(
      (result) => result.toolName === WORKING_MEMORY_TOOL || (result.toolName === "draftTicket" && answeredOk(result)),
    )
  );
}

/** One reply of the agent: the Mastra stream, which the route turns into the chat stream and saves at the end. */
export function streamReply(agent: NexoAgent, { conversationId, employeeId, text }: Turn) {
  return agent.stream(text, {
    memory: { thread: conversationId, resource: employeeId },
    // Whose tickets the tools read: the employee of the session, never a value the model writes. A draft belongs to
    // the conversation of the turn.
    requestContext: new RequestContext([
      ["employeeId", employeeId],
      ["conversationId", conversationId],
    ]),
    maxSteps: MAX_STEPS,
    // An offer that was shown hands the turn to the employee, who answers with a click: calling the model again would
    // only cost. One that could not be shown (refused input, no ticket of hers, service down) lets the model explain.
    stopWhen: ({ steps }: { steps: ReadonlyArray<Step> }) => replyDone(steps.at(-1)),
    // recordDecision is mandatory in the first step; afterwards the model chooses.
    prepareStep: ({ stepNumber }) =>
      stepNumber === 0 ? { toolChoice: { type: "tool", toolName: "recordDecision" } } : undefined,
    modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeout: { totalMs: TOTAL_TIMEOUT_MS } },
  });
}
