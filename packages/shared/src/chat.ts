import { z } from "zod";
import { conversationState, messageAuthor } from "./domain";
import { kbArticleSchema } from "./help-center";

// Contracts of the chat (ARQUITETURA.md, section 7): the route body, the parts of the stream and the conversation
// the screen loads. The agent tools take their schemas from here too, so the screen reads the same shapes.

/** Employee messages per conversation. Only counted in this feature; the limit itself comes in feature 6. */
export const MESSAGE_LIMIT = 30;

// POST /api/chat
export const chatInput = z.object({
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

/**
 * The decision saved with an agent message. Without a valid recordDecision the code saves a reduced record:
 * no confidence and no reason.
 */
export const storedDecision = z.object({
  understanding: z.string(),
  action: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  reason: z.string().nullable(),
  /** The tools that ran, in order, each once. */
  toolsUsed: z.array(z.string()),
});
export type StoredDecision = z.infer<typeof storedDecision>;

// Tools of this feature. A tool never throws at the agent: a failure comes back as { ok: false } so it can explain.

export const searchArticlesInput = z.object({
  query: z.string().trim().min(1).max(200).describe("A dúvida do funcionário, com as palavras dele."),
});
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
export const redirectOutOfScopeOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), area: outOfScopeArea, channel: z.object({ title: z.string(), content: z.string() }) }),
  z.object({ ok: z.literal(false), area: outOfScopeArea, message: z.string() }),
]);
export type RedirectOutOfScopeOutput = z.infer<typeof redirectOutOfScopeOutput>;

/** First part of every chat stream, transient: the conversation the message went to, with the new counter. */
export const conversationPart = z.object({
  id: z.string(),
  state: conversationState,
  messageCount: z.number().int().nonnegative(),
});
export type ConversationPart = z.infer<typeof conversationPart>;

// GET /api/conversation
export const chatMessage = z.object({
  id: z.string(),
  author: messageAuthor,
  text: z.string(),
  createdAt: z.iso.datetime(),
  /** Only agent messages have one. */
  decision: storedDecision.nullable(),
});
export type ChatMessage = z.infer<typeof chatMessage>;

export const conversationResponse = z.object({
  conversation: conversationPart.nullable(),
  messages: z.array(chatMessage),
});
export type ConversationResponse = z.infer<typeof conversationResponse>;
