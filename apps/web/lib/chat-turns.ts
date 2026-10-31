import {
  type DecisionRecord,
  type DraftView,
  decisionOf,
  findTicketIds,
  type NexoUIMessage,
  shownDraft,
  type TicketCard,
  type TicketSummary,
  textOf,
} from "@nexo/shared";
import type { ChatStatus } from "ai";
import { type Step, stepsOf } from "./agent-actions";

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
export type Turn = EmployeeTurn | AgentTurn;

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
export function liveTurns(messages: readonly NexoUIMessage[], status: ChatStatus): Turn[] {
  const answerTo = (index: number) => {
    const next = messages[index + 1];
    return next?.role === "user" ? textOf(next.parts) : null;
  };
  const busy = status === "submitted" || status === "streaming";
  const turns: Turn[] = messages.map((message, index) =>
    message.role === "user"
      ? { kind: "employee", id: message.id, text: textOf(message.parts), unsent: false }
      : { ...agentTurn(message, answerTo(index), busy), phase: "done" },
  );

  const last = turns.at(-1);
  const lastMessage = messages.at(-1);
  if (last?.kind === "agent" && lastMessage) return [...turns.slice(0, -1), settle(agentTurn(lastMessage, null, busy), status)];
  if (last?.kind === "employee" && status === "error") return [...turns.slice(0, -1), { ...last, unsent: true }];
  if (last?.kind === "employee" && status !== "ready") {
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
