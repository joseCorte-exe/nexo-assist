import { decisionRecord, type StoredDecision } from "@nexo/shared";

export type ToolCallSummary = { toolName: string; args: unknown };

/** Tools the memory adds on its own. They keep context, they are not an action the employee should see. */
const INTERNAL_TOOLS = new Set(["updateWorkingMemory"]);

/**
 * The decision saved with an agent reply: what recordDecision said, plus the tools that ran, in order and once each.
 * Without a valid recordDecision it is the reduced record, with no confidence and no reason (ARQUITETURA.md, section 8).
 */
export function summarizeTurn(toolCalls: readonly ToolCallSummary[]): StoredDecision {
  const toolsUsed = [...new Set(toolCalls.map(({ toolName }) => toolName))].filter((name) => !INTERNAL_TOOLS.has(name));

  for (const { toolName, args } of toolCalls) {
    if (toolName !== "recordDecision") continue;
    const parsed = decisionRecord.safeParse(args);
    if (parsed.success) return { ...parsed.data, toolsUsed };
  }
  return { understanding: "", action: "", confidence: null, reason: null, toolsUsed };
}
