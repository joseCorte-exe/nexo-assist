import { type DecisionRecord, decisionRecord, type NexoUIMessage, type StoredDecision } from "./chat";

// Reading the parts of a chat message, the same way on the server, which saves them, and on the screen, which draws
// them, live and after a reload.

type Parts = NexoUIMessage["parts"];

/** Tools the memory adds on its own. They keep context, they are not an action the employee should see. */
const INTERNAL_TOOLS = new Set(["updateWorkingMemory"]);

/** The text of a message, the employee's or the agent's: every text part, in order. */
export function textOf(parts: Parts): string {
  return parts.map((part) => (part.type === "text" ? part.text : "")).join("");
}

/** What recordDecision said: the first valid record, once its input is complete. */
export function decisionOf(parts: Parts): DecisionRecord | null {
  for (const part of parts) {
    if (part.type !== "tool-recordDecision" || part.state === "input-streaming") continue;
    const parsed = decisionRecord.safeParse(part.input);
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * The decision saved with an agent reply: its record, plus the tools that ran, in order and once each. Without a
 * valid recordDecision the record is null, the reduced record (ARQUITETURA.md, section 8).
 */
export function summarizeTurn(parts: Parts): StoredDecision {
  const tools = parts.flatMap((part) => (part.type.startsWith("tool-") ? [part.type.slice("tool-".length)] : []));
  const toolsUsed = [...new Set(tools)].filter((tool) => !INTERNAL_TOOLS.has(tool));
  return { record: decisionOf(parts), toolsUsed };
}
