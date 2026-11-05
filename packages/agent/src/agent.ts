import { Agent } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import type { MastraModelConfig } from "@mastra/core/llm";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { dayAndMonth, type DraftView, isCriticalCase, localDay, nexoToolSchemas } from "@nexo/shared";
import { instructions, workingMemoryTemplate } from "./instructions";
import { createTools, type DraftStore, MIN_CONFIDENCE, newReplyTurn, OFFER_TOOLS, type ResolutionStore, type TicketDesk, type TransferStore } from "./tools";

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
/** Prefix of what happened with an analyst: assumed, wrote, released or closed (feature 5), and of the limit (feature 6). */
export const CONSOLE_NOTE = "(atendimento)";
/** Prefix of the note that she came back on another day (feature 6). */
export const RESUME_NOTE = "(retomada)";

/**
 * Copies to the conversation's memory something that happened outside the agent: what the employee did in a card, what
 * happened in the console, or a message of hers the agent did not answer because an analyst had the conversation. It
 * goes in as her message, since Mastra leaves system messages out of what the model reads; the prefix tells the notes
 * from her own words, which go without one. The same id saved again replaces the note instead of repeating it.
 */
export async function saveNote(
  memory: Pick<AgentMemory, "saveMessages">,
  {
    id,
    conversationId,
    employeeId,
    text,
    at,
    prefix = SCREEN_NOTE,
  }: { id: string; conversationId: string; employeeId: string; text: string; at: Date; prefix?: string | null },
) {
  await memory.saveMessages({
    messages: [
      {
        id,
        role: "user",
        createdAt: at,
        threadId: conversationId,
        resourceId: employeeId,
        content: { format: 2, parts: [{ type: "text", text: prefix ? `${prefix} ${text}` : text }] },
      },
    ],
  });
}

/**
 * saveNote for something that already happened and is saved where it belongs: a memory that did not take the note only
 * costs the agent context, so the failure is logged, never thrown at the request.
 */
export async function rememberNote(memory: Pick<AgentMemory, "saveMessages">, note: Parameters<typeof saveNote>[1]) {
  try {
    await saveNote(memory, note);
  } catch (error) {
    // Only the kind of error: its details can quote what the employee wrote.
    console.error("note not copied to the agent memory", { conversationId: note.conversationId, noteId: note.id, error: (error as Error).name });
  }
}

/**
 * What the agent reads before her message when she comes back on another São Paulo day: since when, and that what the
 * tools said then may have changed. Null on the same day, or with nothing before.
 */
export function resumeNote(previousAt: Date | null, now: Date): string | null {
  if (!previousAt || localDay(now) <= localDay(previousAt)) return null;
  return (
    `A conversa continua hoje, ${dayAndMonth(now)}, depois de uma pausa: a mensagem anterior é de ${dayAndMonth(previousAt)}. ` +
    "O que as ferramentas disseram antes pode ter mudado; consulte de novo antes de falar da situação de um chamado."
  );
}

/**
 * The lines the agent filled in its working memory ("- Problema: notebook lento"), as sentences, without the title and
 * the fields it left empty.
 */
function caseLines(notes: string | null): string[] {
  if (!notes) return [];
  return notes.split("\n").flatMap((line) => {
    const filled = line.match(/^\s*-\s*([^:]+):\s*(\S.*)$/);
    if (!filled) return [];
    const sentence = `${filled[1]!.trim()}: ${filled[2]!.trim()}`;
    return [/[.!?]$/.test(sentence) ? sentence : `${sentence}.`];
  });
}

/**
 * The case as the agent kept it in its working memory, as sentences, for the analyst the code transfers to at the limit.
 * A memory that cannot be read only costs the summary: nothing, logged.
 */
export async function caseNotes(memory: Pick<AgentMemory, "getWorkingMemory">, { conversationId, employeeId }: { conversationId: string; employeeId: string }) {
  try {
    return caseLines(await memory.getWorkingMemory({ threadId: conversationId, resourceId: employeeId }));
  } catch (error) {
    console.error("working memory not read", { conversationId, error: (error as Error).name });
    return [];
  }
}

/** Any model Mastra takes: a "provider/model" id, or a model object such as the simulated one. */
export type AgentModel = MastraModelConfig;

export function createNexoAgent({
  model,
  memory,
  ticketService,
  drafts,
  transfers,
  resolutions,
  now = () => new Date(),
}: {
  model: AgentModel;
  memory: Memory;
  ticketService: TicketDesk;
  /** Where draftTicket keeps the drafts: the conversations database. */
  drafts: DraftStore;
  /** Where transferToAnalyst moves the conversation: the conversations database. */
  transfers: TransferStore;
  /** Where markResolved asks whether the conversation can end: the conversations database. */
  resolutions: ResolutionStore;
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
    tools: createTools({ ticketService, drafts, transfers, resolutions, now }),
  });
}

export type NexoAgent = ReturnType<typeof createNexoAgent>;

export type Turn = {
  /** The Mastra thread: one per conversation. */
  conversationId: string;
  /** The Mastra resource, from the session, never from the model. */
  employeeId: string;
  text: string;
  /** When her message was saved: the reply and what it does go after it. */
  startedAt: Date;
};

type ToolResult = { toolName: string; input?: unknown; output?: unknown };
type Step = { text: string; toolResults: ReadonlyArray<ToolResult> };

/** The Mastra tool the model calls to keep the summary of the case (the working memory). */
const WORKING_MEMORY_TOOL = "updateWorkingMemory";

/** Every tool but the offers, for the steps after a draft was shown. */
const AFTER_DRAFT_TOOLS = [...Object.keys(nexoToolSchemas).filter((tool) => !OFFER_TOOLS.has(tool)), WORKING_MEMORY_TOOL];

/** Tools that close a reply once the model wrote its sentence about them: the screen draws the rest. */
const CLOSING_TOOLS = new Set(["draftTicket", "transferToAnalyst", "markResolved"]);

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
      (result) => result.toolName === WORKING_MEMORY_TOOL || (CLOSING_TOOLS.has(result.toolName) && answeredOk(result)),
    )
  );
}

/** A tool of the reply that ran and answered ok. */
const ran = (steps: ReadonlyArray<Step>, toolName: string) =>
  steps.some((step) => step.toolResults.some((result) => result.toolName === toolName && answeredOk(result)));

/** The model drafted a critical case: the route transfers it once the reply is saved. */
const draftedCritical = (steps: ReadonlyArray<Step>) =>
  steps.some((step) =>
    step.toolResults.some((result) => {
      if (result.toolName !== "draftTicket" || !answeredOk(result)) return false;
      return isCriticalCase((result.output as { value: { draft: DraftView } }).value.draft);
    }),
  );

/** The confidence recordDecision gave in the first step, if the input was a valid one. */
function recordedConfidence(step: Step | undefined): number | null {
  const input = step?.toolResults.find((result) => result.toolName === "recordDecision")?.input as { confidence?: unknown } | undefined;
  return typeof input?.confidence === "number" ? input.confidence : null;
}

/** One reply of the agent: the Mastra stream, which the route turns into the chat stream and saves at the end. */
export function streamReply(agent: NexoAgent, { conversationId, employeeId, text, startedAt }: Turn) {
  // Whose tickets the tools read: the employee of the session, never a value the model writes. A draft and a transfer
  // belong to the conversation of the turn; a transfer also reads the decision of this reply.
  const turn = newReplyTurn(startedAt);
  const requestContext = new RequestContext<unknown>([
    ["employeeId", employeeId],
    ["conversationId", conversationId],
    ["turn", turn],
  ]);
  return agent.stream(text, {
    memory: { thread: conversationId, resource: employeeId },
    requestContext,
    maxSteps: MAX_STEPS,
    // An offer that was shown hands the turn to the employee, who answers with a click: calling the model again would
    // only cost. One that could not be shown (refused input, no ticket of hers, service down) lets the model explain.
    stopWhen: ({ steps }: { steps: ReadonlyArray<Step> }) => replyDone(steps.at(-1)),
    // recordDecision is mandatory in the first step; afterwards the model chooses. Once a draft is shown, the offers go:
    // its card has Confirmar, Editar and Cancelar, and quick replies under it would only send those words as a message.
    // Below 0.6 the step after the decision transfers, as the doubt of the agent: the code says so, not the model. Once
    // transferred, or drafted as critical, which the route transfers, the model only says to whom and until when; once
    // resolved, its closing sentence.
    prepareStep: ({ stepNumber, steps }) => {
      if (stepNumber === 0) return { toolChoice: { type: "tool", toolName: "recordDecision" } };
      if (ran(steps, "transferToAnalyst") || ran(steps, "markResolved") || draftedCritical(steps)) return { activeTools: [WORKING_MEMORY_TOOL] };
      if (stepNumber === 1) {
        turn.confidence = recordedConfidence(steps[0]);
        if (turn.confidence !== null && turn.confidence < MIN_CONFIDENCE) return { toolChoice: { type: "tool", toolName: "transferToAnalyst" } };
      }
      return ran(steps, "draftTicket") ? { activeTools: AFTER_DRAFT_TOOLS } : undefined;
    },
    modelSettings: { maxOutputTokens: MAX_OUTPUT_TOKENS, timeout: { totalMs: TOTAL_TIMEOUT_MS } },
  });
}
