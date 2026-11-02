import { MESSAGE_LIMIT, type NexoUIMessage } from "./chat";
import { textOf } from "./chat-parts";
import type { Affected, ConversationState, DraftOperation, Impact, Urgency } from "./domain";
import { dayAndMonth, localDay } from "./sao-paulo";

// Continuity and the limit (feature 6, ARQUITETURA.md, sections 1 and 8): what is still pending when a conversation
// reaches 30 messages, the case the code transfers then, and the note that tells the agent she came back another day.
// The model decides nothing here.

type Parts = NexoUIMessage["parts"];

/**
 * What keeps a conversation at the limit from simply closing: a draft waiting for her confirmation, her last message
 * without an answer, or the Nexo waiting for hers (quick replies, the list of tickets, or a question in the text).
 */
export type LimitPending = "draft" | "unanswered" | "question";

/** The last message she or the Nexo wrote, with its parts: the notes of the screen and of the console do not count. */
export type LastMessage = { author: "employee" | "agent"; parts: Parts } | null;

/** An offer the Nexo showed waits for her click; one that could not be shown asks nothing. */
const showsOffer = (part: Parts[number]) =>
  (part.type === "tool-offerReplies" || part.type === "tool-offerTicketChoice") &&
  part.state === "output-available" &&
  (part.output as { ok?: unknown }).ok === true;

export function pendingAtLimit({ pendingDraft, lastMessage }: { pendingDraft: boolean; lastMessage: LastMessage }): LimitPending | null {
  if (pendingDraft) return "draft";
  if (!lastMessage) return null;
  if (lastMessage.author === "employee") return "unanswered";
  const asks = lastMessage.parts.some(showsOffer) || textOf(lastMessage.parts).trim().endsWith("?");
  return asks ? "question" : null;
}

/** The draft as the limit reads it: its ticket, or what RN-01 read for a new one. */
export type LimitDraft = {
  operation: DraftOperation;
  ticketId: string | null;
  impact: Impact | null;
  urgency: Urgency | null;
  affected: Affected;
};

export type LimitCase = { ticketId: string | null; classification: { impact: Impact; urgency: Urgency; affected: Affected } | null };

/**
 * The case the code transfers at the limit, for routeTransfer: the ticket of a follow-up or reopening draft, else the
 * last ticket the reply looked up; the classification of a new ticket's draft. Whether that ticket is hers, critical or
 * overdue is read from the ticket-service, never from here.
 */
export function caseAtLimit({ draft, lastReply }: { draft: LimitDraft | null; lastReply: Parts }): LimitCase {
  if (draft?.ticketId) return { ticketId: draft.ticketId, classification: null };
  if (draft?.impact && draft.urgency) {
    return { ticketId: null, classification: { impact: draft.impact, urgency: draft.urgency, affected: draft.affected } };
  }
  let ticketId: string | null = null;
  for (const part of lastReply) {
    if (part.type !== "tool-getTicket" || part.state !== "output-available") continue;
    const output = part.output as { ok?: unknown; ticket?: { id?: unknown } };
    if (output.ok === true && typeof output.ticket?.id === "string") ticketId = output.ticket.id;
  }
  return { ticketId, classification: null };
}

/** The longest summary a transfer keeps (transferToAnalystInput). */
const MAX_SUMMARY = 600;

const PENDING_WORDS: Record<LimitPending, (draftTitle: string | null) => string> = {
  draft: (title) => (title ? `o rascunho "${title}" esperando confirmação` : "um rascunho esperando confirmação"),
  unanswered: () => "a última mensagem do funcionário sem resposta",
  question: () => "uma pergunta do Nexo sem resposta",
};

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
 * The summary the analyst reads when the code transfers at the limit: why it came, then the case as the agent kept it in
 * its working memory, so nobody asks her again.
 */
export function limitSummary({ pending, draftTitle, caseNotes }: { pending: LimitPending; draftTitle: string | null; caseNotes: string | null }) {
  const lines = caseLines(caseNotes);
  const summary = [
    `A conversa chegou ao limite de ${MESSAGE_LIMIT} mensagens com ${PENDING_WORDS[pending](draftTitle)}.`,
    ...(lines.length > 0 ? lines : ["Leia a conversa para o contexto."]),
  ].join(" ");
  return summary.length <= MAX_SUMMARY ? summary : `${summary.slice(0, MAX_SUMMARY - 1).trimEnd()}…`;
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

/** From here on, while the Nexo answers, the counter says what is left. */
export const LIMIT_WARNING_FROM = 25;

/**
 * The line under her composer: the count of the conversation; what is left in the last five, while the Nexo answers;
 * and, past the limit with an analyst, who stays with her instead of a count past 30.
 */
export function counterText(
  count: number,
  { state, limitReached, analystName }: { state: ConversationState; limitReached: boolean; analystName: string | null },
): { text: string; tone: "muted" | "warning" } {
  const paused = state === "waiting_for_analyst" || state === "with_analyst";
  if (limitReached && paused) return { text: `Limite do Nexo atingido · ${analystName ?? "um analista"} continua com você`, tone: "muted" };
  const left = MESSAGE_LIMIT - count;
  if (state === "with_agent" && count >= LIMIT_WARNING_FROM && left > 0) {
    return { text: left === 1 ? "Resta 1 mensagem nesta sessão" : `Restam ${left} mensagens nesta sessão`, tone: "warning" };
  }
  return { text: `${Math.min(count, MESSAGE_LIMIT)}/${MESSAGE_LIMIT} mensagens nesta sessão`, tone: "muted" };
}
