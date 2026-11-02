import {
  type ChatNote,
  type DecisionRecord,
  type DraftView,
  decisionOf,
  findTicketIds,
  type NexoUIMessage,
  shownDraft,
  type TicketCard,
  type TicketSummary,
  localDay,
  textOf,
} from "@nexo/shared";
import type { ChatStatus } from "ai";
import { type Step, stepsOf } from "./agent-actions";
import { dayLabel } from "./format";

// What the chat draws. Saved messages and the ones arriving in the stream are the same UI messages, read here once.

export type { Step };

/**
 * thinking: nothing to show yet; working: decision recorded, tools running; writing: text arriving;
 * done; failed: no answer at all; interrupted: the answer stopped in the middle.
 */
export type Phase = "thinking" | "working" | "writing" | "done" | "failed" | "interrupted";

/**
 * How an offer takes a click. open: each item is a button that sends the choice; busy: the agent is still answering,
 * so the buttons stay (focus is not lost) but do nothing; answered: plain history, with the choice marked.
 */
export type OfferMode = "open" | "busy" | "answered";

/** The quick replies inside the last bubble. question: in bold above them, null when the bubble already asks it. */
export type Replies = { question: string | null; options: string[]; chosen: string | null; mode: OfferMode };

/**
 * What a reply shows, in the order it arrived: text in bubbles, the card of each ticket looked up and the list of
 * tickets to choose from. The draft closes the reply, under the text that introduces it, whatever came first. chosen
 * is what the next message of the employee picked.
 */
export type Block =
  | { kind: "text"; key: string; text: string; replies?: Replies }
  | { kind: "ticket"; key: string; ticket: TicketCard }
  | { kind: "choice"; key: string; tickets: TicketSummary[]; chosen: string | null; mode: OfferMode }
  /** The draft as the agent showed it; the card draws its current state, which the chat keeps by id. */
  | { kind: "draft"; key: string; draft: DraftView };

/** unsent: the message never reached the server (nothing of the reply came back). */
export type EmployeeTurn = { kind: "employee"; id: string; text: string; unsent: boolean };
export type AgentTurn = {
  kind: "agent";
  id: string;
  text: string;
  decision: DecisionRecord | null;
  steps: Step[];
  blocks: Block[];
  phase: Phase;
};
/** A note of the console: transferred, an analyst joined, handed back to the Nexo, closed. */
export type NoteTurn = { kind: "note"; id: string; note: ChatNote };
/** Messages of an analyst in a row, under one sign. */
export type AnalystTurn = { kind: "analyst"; id: string; name: string; level: "N1" | "N2"; messages: Array<{ id: string; text: string }> };
export type Turn = EmployeeTurn | AgentTurn | NoteTurn | AnalystTurn;

/** What choosing a ticket of the list sends, as the design writes it: "INC-20311 · Notebook lento…". */
export const ticketChoiceText = (ticket: Pick<TicketSummary, "id" | "title">) => `${ticket.id} · ${ticket.title}`;

/** The reply the employee picked: the same words, whatever the case, or a message that starts with them. */
function chosenReply(options: string[], answer: string): string | null {
  const said = answer.trim().toLowerCase();
  return (
    options.find((option) => {
      const words = option.toLowerCase();
      return said === words || (said.startsWith(words) && /^[\s.,;:!?]/.test(said.slice(words.length)));
    }) ?? null
  );
}

/**
 * The offer at the end of the reply, as blocks. The list: its question in a bubble (unless the text already asked it),
 * then the list. The replies: inside the last bubble, or in a bubble of their own whose text is the question.
 */
function addOffer(blocks: Block[], part: NexoUIMessage["parts"][number], said: string, answer: string | null, mode: OfferMode) {
  if (part.type === "tool-offerTicketChoice" && part.state === "output-available" && part.output.ok) {
    const { tickets } = part.output;
    const question = part.input.question.trim();
    const chosen = answer === null ? null : (findTicketIds(answer).find((id) => tickets.some((ticket) => ticket.id === id)) ?? null);
    if (!said.includes(question)) blocks.push({ kind: "text", key: `question-${part.toolCallId}`, text: question });
    blocks.push({ kind: "choice", key: part.toolCallId, tickets, chosen, mode });
  } else if (part.type === "tool-offerReplies" && part.state === "output-available" && part.output.ok) {
    const { options } = part.input;
    const question = part.input.question.trim();
    const chosen = answer === null ? null : chosenReply(options, answer);
    const last = blocks.at(-1);
    if (last?.kind === "text") last.replies = { question: said.includes(question) ? null : question, options, chosen, mode };
    else blocks.push({ kind: "text", key: `question-${part.toolCallId}`, text: question, replies: { question: null, options, chosen, mode } });
  }
}

/**
 * answer: the next message of the employee, which answers the offer of this reply, if any. busy: the agent is still
 * answering, so an open offer takes no click yet.
 */
function agentTurn(message: NexoUIMessage, answer: string | null, busy: boolean): AgentTurn {
  const steps: Step[] = [];
  const blocks: Block[] = [];
  const text = textOf(message.parts);
  const mode: OfferMode = answer !== null ? "answered" : busy ? "busy" : "open";
  // Only the last draft: one refused as a possible duplicate is followed by the one that replaced it.
  let draft: Block | null = null;

  message.parts.forEach((part, index) => {
    steps.push(...stepsOf(part));
    if (part.type === "text") {
      const last = blocks.at(-1);
      // Text of several steps in a row is one bubble; a card in between splits it.
      if (last?.kind === "text") last.text += part.text;
      else if (part.text) blocks.push({ kind: "text", key: `text-${index}`, text: part.text });
    } else if (part.type === "tool-getTicket" && part.state === "output-available" && part.output.ok) {
      blocks.push({ kind: "ticket", key: part.toolCallId, ticket: part.output.ticket });
    } else if (part.type === "tool-draftTicket") {
      const shown = shownDraft(part);
      if (shown) draft = { kind: "draft", key: part.toolCallId, draft: shown };
    } else {
      addOffer(blocks, part, text, answer, mode);
    }
  });

  if (draft) blocks.push(draft);

  const decision = decisionOf(message.parts);
  const phase: Phase = text ? "writing" : decision ? "working" : "thinking";
  return { kind: "agent", id: message.id, text, decision, steps, blocks, phase };
}

function settle(turn: AgentTurn, status: ChatStatus): AgentTurn {
  if (status === "ready") return { ...turn, phase: "done" };
  if (status === "error") return { ...turn, phase: turn.text ? "interrupted" : "failed" };
  return turn;
}

/**
 * The messages of the chat, saved or streaming. Only the last reply follows the status of the chat; the ones before
 * it are done. A message without a reply yet gets one at once, thinking; if the request failed before any of the
 * reply came back, the message is marked as not sent instead. The employee message after a reply is its answer,
 * so what was chosen is the same live and after a reload.
 */
export function liveTurns(all: readonly NexoUIMessage[], status: ChatStatus, { paused = false }: { paused?: boolean } = {}): Turn[] {
  // A message sent while an analyst had the conversation streams back only its counter: there is nothing to draw.
  const messages = all.filter((message) => !message.parts.every((part) => part.type === "data-conversation"));
  const answerTo = (index: number) => {
    const next = messages[index + 1];
    return next?.role === "user" ? textOf(next.parts) : null;
  };
  const busy = status === "submitted" || status === "streaming";
  const turns: Turn[] = [];
  messages.forEach((message, index) => {
    const note = message.parts.find((part) => part.type === "data-note");
    const sign = message.parts.find((part) => part.type === "data-analyst");
    if (note?.type === "data-note") {
      turns.push({ kind: "note", id: message.id, note: note.data });
    } else if (sign?.type === "data-analyst") {
      const previous = turns.at(-1);
      const said = { id: message.id, text: textOf(message.parts) };
      if (previous?.kind === "analyst" && previous.name === sign.data.name) previous.messages.push(said);
      else turns.push({ kind: "analyst", id: message.id, name: sign.data.name, level: sign.data.level, messages: [said] });
    } else if (message.role === "user") {
      turns.push({ kind: "employee", id: message.id, text: textOf(message.parts), unsent: false });
    } else {
      turns.push({ ...agentTurn(message, answerTo(index), busy), phase: "done" });
    }
  });

  const last = turns.at(-1);
  const lastMessage = messages.at(-1);
  if (last?.kind === "agent" && lastMessage) return [...turns.slice(0, -1), settle(agentTurn(lastMessage, null, busy), status)];
  if (last?.kind === "employee" && status === "error") return [...turns.slice(0, -1), { ...last, unsent: true }];
  // Nobody answers while an analyst has the conversation: no Nexo thinking under her message.
  if (last?.kind === "employee" && status !== "ready" && !paused) {
    return [
      ...turns,
      { kind: "agent", id: `${last.id}-reply`, text: "", decision: null, steps: [], blocks: [], phase: "thinking" },
    ];
  }
  return turns;
}

/**
 * The x/30 counter: the count of the last reply that brought one (its first part), else the one the page loaded
 * with. A message on its way counts at once; one that never reached the server does not.
 */
export function messageCount(messages: readonly NexoUIMessage[], status: ChatStatus, saved: number): number {
  let count = saved;
  for (const message of messages) {
    for (const part of message.parts) if (part.type === "data-conversation") count = part.data.messageCount;
  }
  return status === "submitted" && messages.at(-1)?.role === "user" ? count + 1 : count;
}

/** The id of the last draft the agent showed in the conversation: the only one that can still be pending. */
export function lastDraftId(messages: readonly NexoUIMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const parts = messages[index]?.parts ?? [];
    for (const part of [...parts].reverse()) {
      const shown = shownDraft(part);
      if (shown) return shown.id;
    }
  }
  return null;
}

/**
 * The draft as it is now: the newest state known (loaded with the conversation, or answered by an action of its card),
 * else as the agent showed it. A pending one that is not the last of the conversation was superseded on the server
 * when the newer one was saved.
 */
export function currentDraft(shown: DraftView, known: Readonly<Record<string, DraftView>>, lastId: string | null): DraftView {
  const draft = known[shown.id] ?? shown;
  return draft.status === "pending" && lastId !== null && draft.id !== lastId ? { ...draft, status: "superseded" } : draft;
}

/** The same messages, by id and parts: a read that brought nothing new does not redraw the chat. */
const sameMessages = (a: readonly NexoUIMessage[], b: readonly NexoUIMessage[]) =>
  a.length === b.length && a.every((message, index) => message.id === b[index]?.id && message.parts.length === b[index]?.parts.length);

/**
 * The messages to show after reading the conversation again, while an analyst has it. Never under a message on its way:
 * it lands with the next read. After a failure, the message that did not reach the server stays at the end, so "Tentar
 * de novo" still has it to send.
 */
export function withSaved(current: NexoUIMessage[], saved: NexoUIMessage[], status: ChatStatus): NexoUIMessage[] {
  if (status === "submitted" || status === "streaming") return current;
  const last = current.at(-1);
  const unsent = status === "error" && last?.role === "user" && !saved.some((message) => message.id === last.id) ? [last] : [];
  const next = [...saved, ...unsent];
  return sameMessages(current, next) ? current : unsent.length > 0 ? next : saved;
}

/**
 * The pills of the days, by the id of the message each one opens: only when the conversation spans more than one São
 * Paulo day (a conversation of one day draws none, as the design of the chat), and then for every day, the first one
 * too, with the console's "Hoje", "Ontem" or "23 out". A message on its way has no date yet: it is now.
 */
export function dayBreaks(messages: readonly NexoUIMessage[], now: Date): Map<string, string> {
  const firsts: Array<{ id: string; at: string; day: number }> = [];
  for (const message of messages) {
    const at = message.metadata?.at ?? now.toISOString();
    const day = localDay(new Date(at));
    if (firsts.at(-1)?.day !== day) firsts.push({ id: message.id, at, day });
  }
  return firsts.length < 2 ? new Map() : new Map(firsts.map(({ id, at }) => [id, dayLabel(at, now)]));
}
