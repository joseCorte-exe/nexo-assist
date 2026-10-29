import {
  type DecisionRecord,
  decisionOf,
  findTicketIds,
  type NexoUIMessage,
  offerRepliesInput,
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

/** What a reply shows, in the order it arrived: text in bubbles and the card of each ticket looked up. */
export type Block = { kind: "text"; key: string; text: string } | { kind: "ticket"; key: string; ticket: TicketCard };

/**
 * A question with its answers as buttons, at the end of a reply: the list of tickets, or the quick replies inside the
 * last bubble. chosen is what the next message of the employee picked; open while nobody answered yet.
 */
export type Offer =
  | { kind: "tickets"; tickets: TicketSummary[]; chosen: string | null; open: boolean }
  | { kind: "replies"; options: string[]; chosen: string | null; open: boolean };

/** unsent: the message never reached the server (nothing of the reply came back). */
export type EmployeeTurn = { kind: "employee"; id: string; text: string; unsent: boolean };
export type AgentTurn = {
  kind: "agent";
  id: string;
  text: string;
  decision: DecisionRecord | null;
  steps: Step[];
  blocks: Block[];
  offer: Offer | null;
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

function offerOf(part: NexoUIMessage["parts"][number], answer: string | null): Offer | null {
  if (part.type === "tool-offerTicketChoice" && part.state === "output-available" && part.output.ok) {
    const { tickets } = part.output;
    const chosen = answer === null ? null : (findTicketIds(answer).find((id) => tickets.some((ticket) => ticket.id === id)) ?? null);
    return { kind: "tickets", tickets, chosen, open: answer === null };
  }
  if (part.type === "tool-offerReplies" && part.state !== "input-streaming") {
    const input = offerRepliesInput.safeParse(part.input);
    if (!input.success) return null;
    const { options } = input.data;
    return { kind: "replies", options, chosen: answer === null ? null : chosenReply(options, answer), open: answer === null };
  }
  return null;
}

/** answer: the next message of the employee, which answers the offer of this reply, if any. */
function agentTurn(message: NexoUIMessage, answer: string | null): AgentTurn {
  const steps: Step[] = [];
  const blocks: Block[] = [];
  let offer: Offer | null = null;

  message.parts.forEach((part, index) => {
    steps.push(...stepsOf(part));
    if (part.type === "text") {
      const last = blocks.at(-1);
      // Text of several steps in a row is one bubble; a card in between splits it.
      if (last?.kind === "text") last.text += part.text;
      else if (part.text) blocks.push({ kind: "text", key: `text-${index}`, text: part.text });
    } else if (part.type === "tool-getTicket" && part.state === "output-available" && part.output.ok) {
      blocks.push({ kind: "ticket", key: part.toolCallId, ticket: part.output.ticket });
    } else {
      offer = offerOf(part, answer) ?? offer;
    }
  });

  const text = textOf(message.parts);
  const decision = decisionOf(message.parts);
  const phase: Phase = text ? "writing" : decision ? "working" : "thinking";
  return { kind: "agent", id: message.id, text, decision, steps, blocks, offer, phase };
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
  const turns: Turn[] = messages.map((message, index) =>
    message.role === "user"
      ? { kind: "employee", id: message.id, text: textOf(message.parts), unsent: false }
      : { ...agentTurn(message, answerTo(index)), phase: "done" },
  );

  const last = turns.at(-1);
  const lastMessage = messages.at(-1);
  if (last?.kind === "agent" && lastMessage) return [...turns.slice(0, -1), settle(agentTurn(lastMessage, null), status)];
  if (last?.kind === "employee" && status === "error") return [...turns.slice(0, -1), { ...last, unsent: true }];
  if (last?.kind === "employee" && status !== "ready") {
    return [
      ...turns,
      { kind: "agent", id: `${last.id}-reply`, text: "", decision: null, steps: [], blocks: [], offer: null, phase: "thinking" },
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
