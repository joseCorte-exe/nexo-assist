import {
  type ConsoleConversation,
  type ConsoleMessage,
  dueIn,
  localDay,
  type NoteView,
  type PanelTicket,
  type TagTone,
  wallClock,
} from "@nexo/shared";
import { dayLabel, firstName, formatDay } from "./format";

// What the console draws, read from the contracts once: the screen only lays it out.

/** The seven avatar tones of nexo.pen: background and initials. */
export const AVATAR_TONES = [
  { background: "#DCE9F7", text: "#0062C4" },
  { background: "#F6E3D3", text: "#9A4A12" },
  { background: "#E6E1F7", text: "#5B3FC4" },
  { background: "#DDF0E6", text: "#1E7A4C" },
  { background: "#F7E1E6", text: "#A3324F" },
  { background: "#E5E8EC", text: "#3D4656" },
  { background: "#FBEFD0", text: "#8A6100" },
] as const;

/**
 * The tone of a person, from a hash of the id: the same on every screen and every visit. The seed and the multiplier
 * are the ones that give the seven sample people, in order, the tones nexo.pen draws them with.
 */
export function avatarTone(id: string) {
  let hash = 563;
  for (const char of id) hash = (hash * 44 + char.charCodeAt(0)) % 1_000_003;
  return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

/**
 * Under the name of the open conversation: "online · Financeiro · INC-20311", with "digitando…" in place of online while
 * she writes. The ticket only while she waits.
 */
export function conversationMeta(conversation: ConsoleConversation): string {
  const presence = conversation.typing ? "digitando…" : conversation.online ? "online" : null;
  const parts = [presence, conversation.employee.department || null];
  if (conversation.state === "waiting_for_analyst" && conversation.ticketId) parts.push(conversation.ticketId);
  return parts.filter(Boolean).join(" · ");
}

/** release: whether it can go back to the agent; past the limit of messages it cannot. */
export type HeaderMode = { kind: "pill"; tone: TagTone; text: string } | { kind: "actions"; release: boolean };

/** What the header of the open conversation shows on its right: a pill with its state, or the actions of who attends. */
export function headerMode(conversation: ConsoleConversation, viewerId: string): HeaderMode {
  switch (conversation.state) {
    case "waiting_for_analyst":
      return { kind: "pill", tone: "warning", text: "Aguardando atendente" };
    case "with_agent":
      return { kind: "pill", tone: "success", text: "Agent atendendo" };
    case "with_analyst":
      return conversation.analyst && conversation.analyst.id !== viewerId
        ? { kind: "pill", tone: "primary", text: `Com ${conversation.analyst.name}` }
        : { kind: "actions", release: !conversation.limitReached };
    case "closed":
      return { kind: "pill", tone: "muted", text: "Encerrada" };
  }
}

/** "12:05", or "29 out, 10:05" when it falls on another day. */
function untilText(iso: string, now: Date) {
  const { days, time } = dueIn(new Date(iso), now);
  return days === 0 ? time : `${formatDay(iso).replace(/^0/, "")}, ${time}`;
}

export type TakeoverBar =
  | { kind: "take"; title: string; body: string; release: boolean; placeholder: string }
  | { kind: "compose"; placeholder: string }
  | { kind: "locked"; text: string };

/** Who wrote the summary a note of transfer opens: the agent, or the code at the limit, from the case the agent kept. */
export function transferSummaryLabel(note: NoteView | null): string | null {
  if (note?.event === "transferred") return "Resumo do agent";
  return note?.event === "limit_reached" && note.limit.then === "transferred" ? "Resumo do caso" : null;
}

const LOCKED_PLACEHOLDER = "Assuma o atendimento para responder";

/**
 * The bottom of the open conversation. Waiting: who waits, until when, and the two buttons over the locked composer.
 * With the agent: the same bar, to take it. The analyst attending writes; anybody else reads.
 */
export function takeoverBar(conversation: ConsoleConversation, viewerId: string, now: Date): TakeoverBar {
  const name = firstName(conversation.employee.name);
  const paused = conversation.limitReached ? "Limite de mensagens · agent pausado" : "Agent pausado";
  switch (conversation.state) {
    case "waiting_for_analyst":
      return {
        kind: "take",
        title: `${name} espera um atendente`,
        body: conversation.waitUntil ? `${paused} · até ${untilText(conversation.waitUntil, now)}` : paused,
        // Past the limit of messages it does not go back to the agent.
        release: !conversation.limitReached,
        placeholder: LOCKED_PLACEHOLDER,
      };
    case "with_agent":
      return { kind: "take", title: `${name} está com o agent`, body: "Assuma para responder no lugar dele", release: false, placeholder: LOCKED_PLACEHOLDER };
    case "with_analyst":
      return conversation.analyst && conversation.analyst.id !== viewerId
        ? { kind: "locked", text: `${conversation.analyst.name} está atendendo esta conversa` }
        : { kind: "compose", placeholder: `Responder a ${name}…` };
    case "closed":
      return { kind: "locked", text: "Atendimento encerrado" };
  }
}

export type HistoryItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "message"; key: string; message: ConsoleMessage; grouped: boolean };


/**
 * The history as the console lays it out: a pill when the day changes, and her messages in a row grouped, the second
 * one closer and with all its corners round, as nexo.pen draws them.
 */
export function historyItems(messages: readonly ConsoleMessage[], now: Date): HistoryItem[] {
  const items: HistoryItem[] = [];
  let day: number | null = null;
  let previous: ConsoleMessage | null = null;
  for (const message of messages) {
    const messageDay = localDay(new Date(message.at));
    if (messageDay !== day) {
      day = messageDay;
      previous = null;
      const clock = wallClock(new Date(message.at)).toISOString().slice(0, 10);
      items.push({ kind: "day", key: `day-${clock}`, label: dayLabel(message.at, now) });
    }
    const grouped = message.author === "employee" && previous?.author === "employee";
    items.push({ kind: "message", key: message.id, message, grouped });
    previous = message;
  }
  return items;
}

/** How many tickets the panel lists under "Outros chamados" before "Ver todos". */
export const OTHER_TICKETS = 4;

/** The panel of the employee's tickets: the one of this conversation apart, then the first others. */
export function panelSections(tickets: readonly PanelTicket[], currentId: string | null) {
  const current = (currentId && tickets.find((ticket) => ticket.id === currentId)) || null;
  const rest = tickets.filter((ticket) => ticket !== current);
  return { current, others: rest.slice(0, OTHER_TICKETS), hidden: Math.max(0, rest.length - OTHER_TICKETS) };
}

/** The last line of the ticket of this conversation: transferred, or assumed by whom. */
export function ticketEvent(conversation: ConsoleConversation): { icon: "transfer" | "analyst"; text: string; at: string } | null {
  if (conversation.state === "with_analyst" && conversation.analyst && conversation.assumedAt) {
    return { icon: "analyst", text: `Assumido por ${conversation.analyst.name}`, at: conversation.assumedAt };
  }
  return conversation.transferredAt ? { icon: "transfer", text: "Transferido para um analista", at: conversation.transferredAt } : null;
}

