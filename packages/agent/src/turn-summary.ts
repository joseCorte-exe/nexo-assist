import { decisionRecord, type NexoUIMessage, type StoredDecision } from "@nexo/shared";

/** Tools the memory adds on its own. They keep context, they are not an action the employee should see. */
const INTERNAL_TOOLS = new Set(["updateWorkingMemory"]);

/**
 * The decision saved with an agent reply, read from the parts of the reply: what recordDecision said, plus the
 * tools that ran, in order and once each. Without a valid recordDecision the record is null, the reduced record
 * (ARQUITETURA.md, section 8).
 */
export function summarizeTurn(parts: NexoUIMessage["parts"]): StoredDecision {
  const calls = parts.flatMap((part) =>
    part.type.startsWith("tool-") && "input" in part ? [{ tool: part.type.slice("tool-".length), input: part.input }] : [],
  );
  const toolsUsed = [...new Set(calls.map(({ tool }) => tool))].filter((tool) => !INTERNAL_TOOLS.has(tool));

  for (const { tool, input } of calls) {
    if (tool !== "recordDecision") continue;
    const parsed = decisionRecord.safeParse(input);
    if (parsed.success) return { record: parsed.data, toolsUsed };
  }
  return { record: null, toolsUsed };
}
