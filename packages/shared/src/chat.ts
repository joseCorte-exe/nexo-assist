import type { UIMessage } from "ai";
import { z } from "zod";
import { conversationState } from "./domain";
import { kbArticleSchema } from "./help-center";

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

/** First part of every chat stream: the conversation the message went to, with the new counter. */
export const conversationPart = z.object({
  id: z.string(),
  state: conversationState,
  messageCount: z.number().int().nonnegative(),
});
export type ConversationPart = z.infer<typeof conversationPart>;

/** The tools of the agent as the stream carries them, with the schemas above. */
export type NexoTools = {
  recordDecision: { input: DecisionRecord; output: z.infer<typeof recordDecisionOutput> };
  searchArticles: { input: SearchArticlesInput; output: SearchArticlesOutput };
  redirectOutOfScope: { input: RedirectOutOfScopeInput; output: RedirectOutOfScopeOutput };
};

/**
 * A message of the chat: text, the parts of each tool and the data-conversation part. An agent reply is saved
 * with these same parts, so the screen draws a reply the same way while it streams and after a reload.
 */
export type NexoUIMessage = UIMessage<never, { conversation: ConversationPart }, NexoTools>;

/** GET /api/conversation: the active conversation, or none, with its messages in order. */
export type ConversationResponse = {
  conversation: ConversationPart | null;
  messages: NexoUIMessage[];
};
