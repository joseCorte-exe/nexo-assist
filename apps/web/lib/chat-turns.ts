import { type ChatMessage, decisionRecord } from "@nexo/shared";
import type { ChatStatus } from "ai";
import { type ActionTool, isActionTool } from "./agent-actions";
import type { NexoUIMessage } from "./chat-message";

// What the chat draws, whether the message came saved from GET /api/conversation or is arriving in the stream.

export type Decision = { understanding: string; action: string; confidence: number | null; reason: string | null };
export type Step = { tool: ActionTool; state: "running" | "done" | "failed" };

/**
 * thinking: nothing to show yet; working: decision recorded, tools running; writing: text arriving;
 * done; failed: no answer at all; interrupted: the answer stopped in the middle.
 */
export type Phase = "thinking" | "working" | "writing" | "done" | "failed" | "interrupted";

export type EmployeeTurn = { kind: "employee"; id: string; text: string };
export type AgentTurn = { kind: "agent"; id: string; text: string; decision: Decision | null; steps: Step[]; phase: Phase };
export type Turn = EmployeeTurn | AgentTurn;

/** The saved conversation. Analyst and system messages come with the console, in feature 5. */
export function turnsFromHistory(messages: readonly ChatMessage[]): Turn[] {
  return messages.flatMap((message): Turn[] => {
    if (message.author === "employee") return [{ kind: "employee", id: message.id, text: message.text }];
    if (message.author !== "agent") return [];
    const { toolsUsed = [], ...decision } = message.decision ?? {};
    return [
      {
        kind: "agent",
        id: message.id,
        text: message.text,
        decision: message.decision ? (decision as Decision) : null,
        steps: toolsUsed.filter(isActionTool).map((tool) => ({ tool, state: "done" })),
        phase: "done",
      },
    ];
  });
}

function agentTurn(message: NexoUIMessage): AgentTurn {
  let decision: Decision | null = null;
  let text = "";
  const steps: Step[] = [];
  for (const part of message.parts) {
    if (part.type === "text") {
      text += part.text;
    } else if (part.type === "tool-recordDecision") {
      // The input is complete from input-available on; while it streams it may be partial.
      const parsed = part.state === "input-streaming" ? null : decisionRecord.safeParse(part.input);
      if (parsed?.success) decision = parsed.data;
    } else if (part.type.startsWith("tool-") && "state" in part) {
      const tool = part.type.slice("tool-".length);
      if (!isActionTool(tool)) continue;
      const failed =
        part.state === "output-error" ||
        (part.state === "output-available" && (part.output as { ok?: boolean } | undefined)?.ok === false);
      const state = failed ? "failed" : part.state === "output-available" ? "done" : "running";
      steps.push({ tool, state });
    }
  }
  const phase: Phase = text ? "writing" : decision ? "working" : "thinking";
  return { kind: "agent", id: message.id, text, decision, steps, phase };
}

function settle(turn: AgentTurn, status: ChatStatus): AgentTurn {
  if (status === "ready") return { ...turn, phase: "done" };
  if (status === "error") return { ...turn, phase: turn.text ? "interrupted" : "failed" };
  return turn;
}

/**
 * The messages of the chat as they stream. Only the last reply follows the status of the chat; the ones before
 * it are done. A message without a reply yet gets one at once: thinking, or failed.
 */
export function liveTurns(messages: readonly NexoUIMessage[], status: ChatStatus): Turn[] {
  const turns: Turn[] = messages.map((message) =>
    message.role === "user"
      ? {
          kind: "employee",
          id: message.id,
          text: message.parts.map((part) => (part.type === "text" ? part.text : "")).join(""),
        }
      : { ...agentTurn(message), phase: "done" },
  );

  const last = turns.at(-1);
  const lastMessage = messages.at(-1);
  if (last?.kind === "agent" && lastMessage) return [...turns.slice(0, -1), settle(agentTurn(lastMessage), status)];
  if (last?.kind === "employee" && status !== "ready") {
    const pending: AgentTurn = { kind: "agent", id: `${last.id}-reply`, text: "", decision: null, steps: [], phase: "thinking" };
    return [...turns, settle(pending, status)];
  }
  return turns;
}
