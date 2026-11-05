import { z } from "zod";
import { MESSAGE_LIMIT, type NoteView, noteView, storedDecision } from "./chat";
import { draftView } from "./drafts";
import {
  analystLevel,
  category,
  conversationOutcome,
  type ConversationOutcome,
  conversationState,
  type ConversationState,
  MAX_MESSAGE_TEXT,
  messageAuthor,
  priority,
  ticketStatus,
  type TicketStatus,
  transferReason,
  type TransferReason,
} from "./domain";
import { TICKET_STATUS_LABEL } from "./labels";
import { clockTime, dayAndMonth, localDay, MONTHS, twoDigits, wallClock } from "./sao-paulo";
import { LEVEL_LABEL } from "./transfer";

// Contracts of the analyst console (ARQUITETURA.md, section 7) and the words it shows. The console and the chat of the
// employee read the notes of what happened (transferred, assumed, released, closed) the same way.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Todas, Para você, Com o agent, Minhas. */
export const consoleFilter = z.enum(["all", "for_you", "with_agent", "mine"]);
export type ConsoleFilter = z.infer<typeof consoleFilter>;

// GET /api/console/conversations?filter=&search=
export const consoleListQuery = z.object({
  filter: consoleFilter.default("all"),
  search: z
    .string()
    .max(100)
    .optional()
    .transform((value) => value?.trim() || undefined),
});
export type ConsoleListQuery = z.infer<typeof consoleListQuery>;

export const analystSign = z.object({ id: z.string(), name: z.string(), level: analystLevel });
export type AnalystSign = z.infer<typeof analystSign>;

/** A conversation as a line of the list, and the head of the open one. */
export const consoleConversation = z.object({
  id: z.string(),
  employee: z.object({ id: z.string(), name: z.string(), department: z.string() }),
  state: conversationState,
  outcome: conversationOutcome.nullable(),
  targetLevel: analystLevel.nullable(),
  transferReason: transferReason.nullable(),
  /** The confidence the agent recorded when it transferred, for "Agent pediu ajuda · confiança 41%". */
  transferConfidence: z.number().min(0).max(1).nullable(),
  ticketId: z.string().nullable(),
  waitUntil: z.iso.datetime().nullable(),
  transferredAt: z.iso.datetime().nullable(),
  assumedAt: z.iso.datetime().nullable(),
  /** The limit of messages applied: it does not go back to the agent. */
  limitReached: z.boolean(),
  /** Who is attending, or who closed it. */
  analyst: analystSign.nullable(),
  lastActivityAt: z.iso.datetime(),
  /** The last message she or he can read, without the notes. */
  preview: z.object({ author: messageAuthor, text: z.string(), at: z.iso.datetime(), seen: z.boolean() }).nullable(),
  /** Messages of the employee after this analyst last read the conversation. */
  unread: z.number().int().nonnegative(),
  /** The chat of the employee is open, and she is writing. */
  online: z.boolean(),
  typing: z.boolean(),
});
export type ConsoleConversation = z.infer<typeof consoleConversation>;

export const consoleListResponse = z.object({
  conversations: z.array(consoleConversation),
  /** The numbers on the chips. Todas has none. */
  counts: z.object({ forYou: z.number().int(), withAgent: z.number().int(), mine: z.number().int() }),
  /** The badge of the rail: conversations waiting for an analyst, of any level. */
  waiting: z.number().int(),
});
export type ConsoleListResponse = z.infer<typeof consoleListResponse>;

export const consoleMessage = z.object({
  id: z.string(),
  author: messageAuthor,
  text: z.string(),
  at: z.iso.datetime(),
  /** Who wrote an analyst message. */
  analyst: analystSign.nullable(),
  /** What the agent recorded for its reply. */
  decision: storedDecision.nullable(),
  /** A note of the console; null for the notes of a draft. */
  note: noteView.nullable(),
  /** An agent or analyst message the employee was on the chat after: the double check turns blue. */
  seen: z.boolean(),
  /** The draft the agent showed in this reply, as it is now in drafts. */
  draftId: z.string().nullable(),
});
export type ConsoleMessage = z.infer<typeof consoleMessage>;

// GET /api/console/conversations/:id
export const consoleDetail = z.object({
  conversation: consoleConversation.extend({ transferSummary: z.string().nullable() }),
  messages: z.array(consoleMessage),
  drafts: z.array(draftView),
});
export type ConsoleDetail = z.infer<typeof consoleDetail>;

// POST /api/console/conversations/:id/messages
export const analystMessageInput = z.object({
  /** The id the console gave the message. Sent again, it is the same message. */
  id: z.string().regex(/^[\w-]{1,100}$/),
  text: z
    .string({ error: "Escreva sua mensagem." })
    .trim()
    .min(1, "Escreva sua mensagem.")
    .max(MAX_MESSAGE_TEXT, "A mensagem pode ter até 2.000 caracteres."),
});
export type AnalystMessageInput = z.infer<typeof analystMessageInput>;

// PATCH /api/console/me
export const availabilityInput = z.object({ available: z.boolean() });
export type AvailabilityInput = z.infer<typeof availabilityInput>;

/** A ticket in the panel "Chamados da Ana". */
export const panelTicket = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: ticketStatus,
  category,
  subcategory: z.string().nullable(),
  priority,
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  assigneeName: z.string().nullable(),
});
export type PanelTicket = z.infer<typeof panelTicket>;

// GET /api/console/employees/:id/tickets: every ticket, the open ones first (newest first), then the resolved ones
// (most recently resolved first).
export const employeeTicketsPanel = z.object({
  employee: z.object({ id: z.string(), name: z.string() }),
  open: z.number().int(),
  closed: z.number().int(),
  tickets: z.array(panelTicket),
});
export type EmployeeTicketsPanel = z.infer<typeof employeeTicketsPanel>;

export type TagTone = "danger" | "warning" | "success" | "primary" | "muted";

type TagInput = {
  state: ConversationState;
  outcome: ConversationOutcome | null;
  transferReason: TransferReason | null;
  transferConfidence: number | null;
  ticketId: string | null;
  waitUntil: string | null;
  analyst: { id: string; name: string } | null;
};

/** The confidence as a percent, rounded down so a low one never reads as 60%. */
const percentOf = (confidence: number) => Math.floor(Math.round(confidence * 1000) / 10);

/**
 * The line under each conversation of the list: what it needs, in the words and the color of the design. An agent that
 * asked for help comes before the ticket, which comes before the wait.
 */
export function conversationTag(conversation: TagInput, viewerId: string, now: Date): { tone: TagTone; text: string } {
  const { state, analyst } = conversation;
  if (state === "waiting_for_analyst") {
    if (conversation.transferReason === "agent_unsure") {
      const { transferConfidence: confidence } = conversation;
      return { tone: "warning", text: confidence === null ? "Agent pediu ajuda" : `Agent pediu ajuda · confiança ${percentOf(confidence)}%` };
    }
    const lead = conversation.transferReason === "message_limit" ? "Limite de mensagens" : "Transferida";
    if (conversation.ticketId) return { tone: "danger", text: `${lead} · ${conversation.ticketId}` };
    return { tone: "danger", text: conversation.waitUntil ? `${lead} · ${contactText(conversation.waitUntil, now)}` : lead };
  }
  if (state === "with_analyst") {
    return { tone: "primary", text: analyst && analyst.id !== viewerId ? `${analyst.name} atendendo` : "Você está atendendo" };
  }
  if (state === "with_agent") return { tone: "success", text: "Agent atendendo" };
  return { tone: "muted", text: closedText(conversation.outcome, analyst, viewerId) };
}

function closedText(outcome: ConversationOutcome | null, analyst: { id: string; name: string } | null, viewerId: string) {
  if (outcome === "resolved_by_agent") return "Resolvida pelo agent";
  if (outcome === "limit_reached") return "Limite de mensagens";
  if (outcome === "closed_by_analyst" && analyst) return `Encerrada por ${analyst.id === viewerId ? "você" : analyst.name}`;
  return "Encerrada";
}

/** When the analyst should get in touch: "contato em 25 min", "contato até 14:15", "contato até 29 out". */
export function contactText(waitUntil: string, now: Date): string {
  const due = new Date(waitUntil);
  const left = due.getTime() - now.getTime();
  if (left <= 0) return "contato atrasado";
  if (left < HOUR_MS) return `contato em ${Math.ceil(left / MINUTE_MS)} min`;
  return localDay(due) === localDay(now) ? `contato até ${clockTime(due)}` : `contato até ${dayAndMonth(due)}`;
}

/** "02 set": a day of a list, with two digits as the design writes it. */
const listDay = (date: Date) => {
  const clock = wallClock(date);
  return `${twoDigits(clock.getUTCDate())} ${MONTHS[clock.getUTCMonth()]}`;
};

/** The time on the right of a line of the list: "agora", "09:58", "ontem" or "24 out", in São Paulo days. */
export function listTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (now.getTime() - at.getTime() < MINUTE_MS) return "agora";
  const days = localDay(now) - localDay(at);
  if (days <= 0) return clockTime(at);
  return days === 1 ? "ontem" : listDay(at);
}

/** The note between the messages, without its time: "Transferida para Suporte N2". */
export function noteLabel(note: NoteView): string {
  switch (note.event) {
    case "transferred":
      return `Transferida para ${LEVEL_LABEL[note.level]}`;
    case "assumed":
      return `${note.analystName} assumiu · agent pausado`;
    case "released":
      return `${note.analystName} devolveu ao agent`;
    case "closed":
      return `${note.analystName} encerrou o atendimento`;
    case "resolved":
      return "Resolvida pelo agent · conversa encerrada";
    case "limit_reached":
      return `${LIMIT_LEAD} · ${limitThen(note.limit)}`;
  }
}

const LIMIT_LEAD = `Limite de ${MESSAGE_LIMIT} mensagens atingido`;

/** What the limit did, as the console reads it. */
function limitThen(limit: Extract<NoteView, { event: "limit_reached" }>["limit"]): string {
  switch (limit.then) {
    case "closed":
      return "conversa encerrada";
    case "transferred":
      return `transferida para ${LEVEL_LABEL[limit.level]}`;
    case "with_analyst":
      return limit.analystName ? `com ${limit.analystName}` : "com o analista";
    case "waiting":
      return `esperando o ${LEVEL_LABEL[limit.level]}`;
  }
}

/** The second line of a ticket in the panel: "INC-20298 · Em andamento", "INC-19877 · Resolvido em 02 set". */
export function ticketLine({ id, status, resolvedAt }: { id: string; status: TicketStatus; resolvedAt: string | null }): string {
  if (status === "resolved" && resolvedAt) return `${id} · Resolvido em ${listDay(new Date(resolvedAt))}`;
  return `${id} · ${TICKET_STATUS_LABEL[status]}`;
}

/**
 * The same note in the chat of the employee, without the time. She knows the agent as the Nexo, and an analyst who takes
 * the conversation joins it: the words differ from the console's where they would be ours, not hers.
 */
export function employeeNoteLabel(note: NoteView): string {
  switch (note.event) {
    case "assumed":
      return `${note.analystName} entrou na conversa`;
    case "released":
      return `${note.analystName} devolveu a conversa ao Nexo`;
    case "resolved":
      return "Resolvida pelo Nexo · conversa encerrada";
    case "limit_reached":
      if (note.limit.then === "with_analyst") return `${LIMIT_LEAD} · ${note.limit.analystName ?? "o analista"} continua com você`;
      return note.limit.then === "waiting" ? `${LIMIT_LEAD} · o analista continua com você` : noteLabel(note);
    default:
      return noteLabel(note);
  }
}
