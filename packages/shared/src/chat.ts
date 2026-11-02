import type { UIMessage } from "ai";
import { z } from "zod";
import {
  affected,
  analystLevel,
  category,
  conversationEvent,
  conversationState,
  type ConversationState,
  impact,
  priority,
  ticketStatus,
  ticketType,
  transferReason,
  urgency,
} from "./domain";
import { kbArticleSchema } from "./help-center";
import { type DraftView, draftTicketInput, draftTicketOutput } from "./drafts";
import { ticketId, ticketSummary } from "./tickets";

// Contracts of the chat (ARQUITETURA.md, section 7): the route body, the parts of the stream and the conversation
// the screen loads. The agent tools take their schemas from here too, so the screen reads the same shapes.

/** Employee messages per conversation. Only counted in this feature; the limit itself comes in feature 6. */
export const MESSAGE_LIMIT = 30;

// POST /api/chat
export const chatInput = z.object({
  /** The id the chat gave the message. Sent again after a failure, it is the same message, not a new one. */
  id: z.string().regex(/^[\w-]{1,100}$/),
  text: z
    .string({ error: "Escreva sua mensagem." })
    .trim()
    .min(1, "Escreva sua mensagem.")
    .max(2000, "A mensagem pode ter até 2.000 caracteres."),
});
export type ChatInput = z.infer<typeof chatInput>;

/** What the agent fills in recordDecision, the first step of every reply. */
export const decisionRecord = z.object({
  understanding: z.string().trim().min(1).max(300).describe("O que você entendeu que o funcionário quer, em uma frase."),
  action: z.string().trim().min(1).max(300).describe("A ação que você vai tomar agora, em uma frase."),
  confidence: z.number().min(0).max(1).describe("Sua segurança nessa ação, de 0 a 1."),
  reason: z.string().trim().min(1).max(500).describe("Por que essa ação, em uma ou duas frases."),
});
export type DecisionRecord = z.infer<typeof decisionRecord>;

export const recordDecisionOutput = z.object({ recorded: z.literal(true) });

/**
 * The decision saved with an agent message, for the console. Without a valid recordDecision the record is null:
 * the reduced record, with only the tools that ran.
 */
export const storedDecision = z.object({
  record: decisionRecord.nullable(),
  /** The tools that ran, in order, each once. */
  toolsUsed: z.array(z.string()),
});
export type StoredDecision = z.infer<typeof storedDecision>;

// Tools of this feature. A tool never throws at the agent: a failure comes back as { ok: false } so it can explain.

export const searchArticlesInput = z.object({
  query: z.string().trim().min(1).max(200).describe("A dúvida do funcionário, com as palavras dele."),
});
export type SearchArticlesInput = z.infer<typeof searchArticlesInput>;
export const searchArticlesOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), articles: z.array(kbArticleSchema) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type SearchArticlesOutput = z.infer<typeof searchArticlesOutput>;

export const outOfScopeArea = z.enum(["hr", "finance", "facilities"]);
export type OutOfScopeArea = z.infer<typeof outOfScopeArea>;

export const redirectOutOfScopeInput = z.object({
  area: outOfScopeArea.describe("hr para RH, finance para financeiro, facilities para facilities."),
});
export type RedirectOutOfScopeInput = z.infer<typeof redirectOutOfScopeInput>;
export const redirectOutOfScopeOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), area: outOfScopeArea, channel: z.object({ title: z.string(), content: z.string() }) }),
  z.object({ ok: z.literal(false), area: outOfScopeArea, message: z.string() }),
]);
export type RedirectOutOfScopeOutput = z.infer<typeof redirectOutOfScopeOutput>;

// Tools of the ticket lookup (feature 3). Whose tickets they are never comes from the model: the route puts the
// employee of the session in the request context, and the inputs have no field for it.

export const listMyTicketsInput = z.object({
  scope: z
    .enum(["open", "all"])
    .default("open")
    .describe("open: só os chamados abertos (não resolvidos). all: inclui os resolvidos."),
});
export type ListMyTicketsInput = z.infer<typeof listMyTicketsInput>;
export const listMyTicketsOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    tickets: z.array(ticketSummary),
    /**
     * With scope open: the tickets resolved up to 7 days ago, which are reopened if the problem came back. Optional so
     * that replies saved before it still read back.
     */
    recentlyResolved: z.array(ticketSummary).optional(),
  }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type ListMyTicketsOutput = z.infer<typeof listMyTicketsOutput>;

export const getTicketInput = z.object({
  ticketId: ticketId.describe("O número do chamado, como INC-20311 ou REQ-10442."),
});
export type GetTicketInput = z.infer<typeof getTicketInput>;

/**
 * The card of a ticket, as it was when the agent looked it up. The numbers are ready, so the model never does date
 * arithmetic: days without an update and the deadline of the priority in words.
 */
export const ticketCard = z.object({
  id: z.string(),
  type: ticketType,
  title: z.string(),
  description: z.string(),
  category,
  subcategory: z.string().nullable(),
  priority,
  status: ticketStatus,
  assigneeName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  dueAt: z.iso.datetime(),
  overdue: z.boolean(),
  daysSinceUpdate: z.number().int().nonnegative(),
  /** The deadline of the priority in words: "3 dias úteis". */
  deadline: z.string(),
  /** What IT wrote last, if it wrote anything. */
  lastItUpdate: z.string().nullable(),
  /** When the agent looked it up: the card shows "há N dias" counted from here, as the agent said it. */
  checkedAt: z.iso.datetime(),
});
export type TicketCard = z.infer<typeof ticketCard>;

export const getTicketOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), ticket: ticketCard }),
  z.object({ ok: z.literal(false), reason: z.enum(["not_found", "unavailable"]), message: z.string() }),
]);
export type GetTicketOutput = z.infer<typeof getTicketOutput>;

export const offerTicketChoiceInput = z.object({
  // In the input, not in the text: a model that skips the text still never shows the list without its question.
  question: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("A pergunta que aparece acima da lista, como \"Você tem 3 chamados abertos. Sobre qual deles quer saber?\"."),
  ticketIds: z.array(ticketId).min(2).max(8).describe("Os números dos chamados que o funcionário pode escolher."),
});
export type OfferTicketChoiceInput = z.infer<typeof offerTicketChoiceInput>;
export const offerTicketChoiceOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), tickets: z.array(ticketSummary) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type OfferTicketChoiceOutput = z.infer<typeof offerTicketChoiceOutput>;

export const offerRepliesInput = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe("O texto da pergunta que aparece acima dos botões, como \"Quer que eu chame um analista?\"."),
  options: z
    .array(z.string().trim().min(1).max(40))
    .min(2)
    .max(4)
    .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === options.length, {
      message: "As opções precisam ser diferentes.",
    })
    .describe("De 2 a 4 respostas curtas que o funcionário pode clicar."),
});
export type OfferRepliesInput = z.infer<typeof offerRepliesInput>;
export const offerRepliesOutput = z.object({ ok: z.literal(true) });

// The transfer to an analyst (feature 5). The model says why and writes the summary; the level, the wait and whether the
// case is critical or overdue come from the code (routeTransfer), from the ticket or from RN-01.

/** Fewer characters than this cannot tell the analyst what happens without asking again. */
const MIN_TRANSFER_SUMMARY = 20;

export const transferToAnalystInput = z
  .object({
    reason: z
      .enum(["employee_request", "agent_unsure"])
      .describe("employee_request: o funcionário pediu um analista. agent_unsure: você não sabe o que fazer, mesmo com a informação."),
    summary: z
      .string()
      .trim()
      .min(MIN_TRANSFER_SUMMARY)
      .max(600)
      .describe(
        "O caso para o analista não precisar perguntar de novo: o que acontece, desde quando, o que já foi tentado, o impacto e o que o funcionário quer.",
      ),
    ticketId: ticketId.optional().describe("O chamado do funcionário sobre o caso, se houver."),
    impact: impact.optional().describe("Sem chamado: stopped, degraded ou request, como no draftTicket."),
    urgency: urgency.optional().describe("Sem chamado: same_day ou none."),
    affected: affected.optional().describe("Sem chamado: only_me, my_team ou company."),
  })
  .superRefine((input, context) => {
    const given = [input.impact, input.urgency, input.affected].filter((value) => value !== undefined).length;
    if (given !== 0 && given !== 3) {
      context.addIssue({ code: "custom", message: "Informe impact, urgency e affected juntos, ou nenhum deles." });
    }
  });
export type TransferToAnalystInput = z.infer<typeof transferToAnalystInput>;

export const transferToAnalystOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    level: analystLevel,
    /** "Suporte N2", as the employee and the console read it. */
    levelLabel: z.string(),
    transferReason,
    ticketId: z.string().nullable(),
    waitUntil: z.iso.datetime(),
    /** The wait in words, for the model to say: "hoje, até 12:05". */
    waitText: z.string(),
  }),
  z.object({ ok: z.literal(false), reason: z.enum(["not_with_agent", "ticket_not_found"]), message: z.string() }),
]);
export type TransferToAnalystOutput = z.infer<typeof transferToAnalystOutput>;

/** The schemas of each tool: for the agent that runs them, and to check saved messages when they are read back. */
export const nexoToolSchemas = {
  recordDecision: { inputSchema: decisionRecord, outputSchema: recordDecisionOutput },
  searchArticles: { inputSchema: searchArticlesInput, outputSchema: searchArticlesOutput },
  redirectOutOfScope: { inputSchema: redirectOutOfScopeInput, outputSchema: redirectOutOfScopeOutput },
  listMyTickets: { inputSchema: listMyTicketsInput, outputSchema: listMyTicketsOutput },
  getTicket: { inputSchema: getTicketInput, outputSchema: getTicketOutput },
  offerTicketChoice: { inputSchema: offerTicketChoiceInput, outputSchema: offerTicketChoiceOutput },
  offerReplies: { inputSchema: offerRepliesInput, outputSchema: offerRepliesOutput },
  draftTicket: { inputSchema: draftTicketInput, outputSchema: draftTicketOutput },
  transferToAnalyst: { inputSchema: transferToAnalystInput, outputSchema: transferToAnalystOutput },
};

/** Who wrote an analyst message in the chat, and the name she reads above it. */
export const analystPart = z.object({ name: z.string(), level: analystLevel });
export type AnalystPart = z.infer<typeof analystPart>;

/**
 * First part of every chat stream, and the conversation as the chat loads it: where the message went, the counter, who
 * it waits for, until when, and who attends it.
 */
export const conversationView = z.object({
  id: z.string(),
  state: conversationState,
  messageCount: z.number().int().nonnegative(),
  targetLevel: analystLevel.nullable(),
  waitUntil: z.iso.datetime().nullable(),
  analyst: analystPart.nullable(),
});
export type ConversationView = z.infer<typeof conversationView>;

/** An analyst has the conversation, or it waits for one: the agent does not answer her, and the chat reads it again. */
export const isPaused = (state: ConversationState) => state === "waiting_for_analyst" || state === "with_analyst";

// What each note of a transfer or of the console says: who it goes to, and who did it. Each event has its own shape, so
// a note never lacks what its sentence needs.
const transferredNote = z.object({ event: z.literal("transferred"), level: analystLevel });
const assumedNote = z.object({ event: z.literal("assumed"), level: analystLevel, analystName: z.string() });
const releasedNote = z.object({ event: z.literal("released"), analystName: z.string() });
const closedNote = z.object({ event: z.literal("closed"), analystName: z.string() });

/** A note, ready to be written: "Rafael Lima assumiu · agent pausado". */
export const noteView = z.discriminatedUnion("event", [transferredNote, assumedNote, releasedNote, closedNote]);
export type NoteView = z.infer<typeof noteView>;

/** A note in the chat, with its time: "Transferida para Suporte N2 · 10:05". */
const at = { at: z.iso.datetime() };
export const chatNote = z.discriminatedUnion("event", [
  transferredNote.extend(at),
  assumedNote.extend(at),
  releasedNote.extend(at),
  closedNote.extend(at),
]);
export type ChatNote = z.infer<typeof chatNote>;

// POST /api/conversation/presence: the chat is open, and whether she is writing. It answers the state of the conversation,
// so a chat that does not poll still learns an analyst took it.
export const presenceInput = z.object({ typing: z.boolean() });
export type PresenceInput = z.infer<typeof presenceInput>;
export type PresenceResponse = { conversation: Pick<ConversationView, "id" | "state"> | null };

/** The tools of the agent as the stream carries them, typed by the schemas above. */
export type NexoTools = {
  [Name in keyof typeof nexoToolSchemas]: {
    input: z.infer<(typeof nexoToolSchemas)[Name]["inputSchema"]>;
    output: z.infer<(typeof nexoToolSchemas)[Name]["outputSchema"]>;
  };
};

/**
 * A message of the chat: text, the parts of each tool and the data-conversation, data-note and data-analyst parts. An agent reply is saved
 * with these same parts, so the screen draws a reply the same way while it streams and after a reload.
 */
export type NexoUIMessage = UIMessage<never, { conversation: ConversationView; note: ChatNote; analyst: AnalystPart }, NexoTools>;

/**
 * GET /api/conversation: the active conversation, or none, with its messages in order and its drafts as they are now.
 * A saved reply keeps the draft as it was shown; the card draws the current one, confirmed, edited or cancelled since.
 */
export type ConversationResponse = {
  conversation: ConversationView | null;
  messages: NexoUIMessage[];
  drafts: DraftView[];
};
