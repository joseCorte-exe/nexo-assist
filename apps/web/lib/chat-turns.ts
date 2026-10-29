import { type DecisionRecord, decisionRecord, type NexoUIMessage } from "@nexo/shared";
import type { ChatStatus } from "ai";
import { type ActionTool, isActionTool } from "./agent-actions";

// What the chat draws. Saved messages and the ones arriving in the stream are the same UI messages, read here once.

export type Step = { tool: ActionTool; state: "running" | "done" | "failed" };

/**
 * thinking: nothing to show yet; working: decision recorded, tools running; writing: text arriving;
 * done; failed: no answer at all; interrupted: the answer stopped in the middle.
 */
export type Phase = "thinking" | "working" | "writing" | "done" | "failed" | "interrupted";

/** unsent: the message never reached the server (nothing of the reply came back). */
export type EmployeeTurn = { kind: "employee"; id: string; text: string; unsent: boolean };
export type AgentTurn = { kind: "agent"; id: string; text: string; decision: DecisionRecord | null; steps: Step[]; phase: Phase };
export type Turn = EmployeeTurn | AgentTurn;

const textOf = (message: NexoUIMessage) => message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

function agentTurn(message: NexoUIMessage): AgentTurn {
  let decision: DecisionRecord | null = null;
  const steps: Step[] = [];
  for (const part of message.parts) {
    if (part.type === "tool-recordDecision") {
      // The input is complete from input-available on; while it streams it may be partial.
      const parsed = part.state === "input-streaming" ? null : decisionRecord.safeParse(part.input);
      if (parsed?.success) decision ??= parsed.data;
    } else if (part.type === "tool-searchArticles" || part.type === "tool-redirectOutOfScope") {
      const tool = part.type.slice("tool-".length);
      if (!isActionTool(tool)) continue;
      const failed = part.state === "output-error" || (part.state === "output-available" && !part.output.ok);
      steps.push({ tool, state: failed ? "failed" : part.state === "output-available" ? "done" : "running" });
    }
  }
  const text = textOf(message);
  const phase: Phase = text ? "writing" : decision ? "working" : "thinking";
  return { kind: "agent", id: message.id, text, decision, steps, phase };
}

function settle(turn: AgentTurn, status: ChatStatus): AgentTurn {
  if (status === "ready") return { ...turn, phase: "done" };
  if (status === "error") return { ...turn, phase: turn.text ? "interrupted" : "failed" };
  return turn;
}

/**
 * The messages of the chat, saved or streaming. Only the last reply follows the status of the chat; the ones before
 * it are done. A message without a reply yet gets one at once, thinking; if the request failed before any of the
 * reply came back, the message is marked as not sent instead.
 */
export function liveTurns(messages: readonly NexoUIMessage[], status: ChatStatus): Turn[] {
  const turns: Turn[] = messages.map((message) =>
    message.role === "user"
      ? { kind: "employee", id: message.id, text: textOf(message), unsent: false }
      : { ...agentTurn(message), phase: "done" },
  );

  const last = turns.at(-1);
  const lastMessage = messages.at(-1);
  if (last?.kind === "agent" && lastMessage) return [...turns.slice(0, -1), settle(agentTurn(lastMessage), status)];
  if (last?.kind === "employee" && status === "error") return [...turns.slice(0, -1), { ...last, unsent: true }];
  if (last?.kind === "employee" && status !== "ready") {
    return [...turns, { kind: "agent", id: `${last.id}-reply`, text: "", decision: null, steps: [], phase: "thinking" }];
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
