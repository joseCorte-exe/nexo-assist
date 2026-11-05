import { MESSAGE_LIMIT, type NexoUIMessage } from "./chat";
import { textOf } from "./chat-parts";
import { type Affected, type DraftOperation, type Impact, MAX_TRANSFER_SUMMARY, type Urgency } from "./domain";

// The limit (feature 6, ARQUITETURA.md, sections 1 and 8): what is still pending when a conversation reaches 30 messages
// and the case the code transfers then. The model decides nothing here.

/** Whether a conversation counts the messages that reach the limit. */
export const reachedLimit = (messageCount: number) => messageCount >= MESSAGE_LIMIT;

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
  part.output.ok;

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
    if (part.output.ok) ticketId = part.output.ticket.id;
  }
  return { ticketId, classification: null };
}

const PENDING_WORDS: Record<LimitPending, (draftTitle: string | null) => string> = {
  draft: (title) => (title ? `o rascunho "${title}" esperando confirmação` : "um rascunho esperando confirmação"),
  unanswered: () => "a última mensagem do funcionário sem resposta",
  question: () => "uma pergunta do Nexo sem resposta",
};

/**
 * The summary the analyst reads when the code transfers at the limit: why it came, then the case as the agent kept it in
 * its working memory, so nobody asks her again.
 */
export function limitSummary({ pending, draftTitle, caseLines }: { pending: LimitPending; draftTitle: string | null; caseLines: string[] }) {
  const summary = [
    `A conversa chegou ao limite de ${MESSAGE_LIMIT} mensagens com ${PENDING_WORDS[pending](draftTitle)}.`,
    ...(caseLines.length > 0 ? caseLines : ["Leia a conversa para o contexto."]),
  ].join(" ");
  return summary.length <= MAX_TRANSFER_SUMMARY ? summary : `${summary.slice(0, MAX_TRANSFER_SUMMARY - 1).trimEnd()}…`;
}
