import type { Affected, Impact, Priority, Urgency } from "./domain";

/**
 * RN-01: the Annex A table, read top to bottom; the first row that matches wins.
 */
export function priorityFor(input: { impact: Impact; urgency: Urgency; affected: Affected }): Priority {
  const { impact, urgency, affected } = input;
  if (impact === "stopped" && affected !== "only_me") return "critical";
  if (impact === "stopped" || urgency === "same_day") return "high";
  if (impact === "degraded") return "medium";
  return "low";
}
