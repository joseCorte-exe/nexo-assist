import { type Affected, type AnalystLevel, type Impact, MAX_TRANSFER_SUMMARY, type Priority, type TicketStatus, type TransferReason, type Urgency } from "./domain";
import { priorityFor } from "./priority";
import { dueAt, isOverdue } from "./sla";

// Who takes a transferred conversation and how long the employee waits (ARQUITETURA.md, sections 1 and 8). The model
// says why it transfers; the level comes from the case, which the code reads.

export const LEVEL_LABEL: Record<AnalystLevel, string> = { N1: "Suporte N1", N2: "Suporte N2" };

/** A summary the code writes, cut to what the analyst's summary holds. */
export const fitSummary = (summary: string) => (summary.length <= MAX_TRANSFER_SUMMARY ? summary : `${summary.slice(0, MAX_TRANSFER_SUMMARY - 1).trimEnd()}…`);

/**
 * What the model may ask for, plus the limit of messages, which the code asks for. Critical and overdue are only ever
 * decided here, from the ticket or RN-01.
 */
export type RequestedReason = Extract<TransferReason, "employee_request" | "agent_unsure" | "message_limit">;

export type TransferRoute = { level: AnalystLevel; reason: TransferReason; priority: Priority; waitUntil: Date };

/**
 * A critical case or an overdue ticket goes to N2, whatever was asked, the critical one named first; anything else goes
 * to N1 for the reason asked. The priority of the case is the ticket's; without one, what RN-01 reads from the model's
 * classification; without that, medium. The wait is the deadline of that priority, counted from the transfer.
 */
export function routeTransfer({
  requested,
  ticket,
  classification,
  at,
}: {
  requested: RequestedReason;
  ticket: { priority: Priority; status: TicketStatus; dueAt: string } | null;
  classification: { impact: Impact; urgency: Urgency; affected: Affected } | null;
  at: Date;
}): TransferRoute {
  const priority = ticket?.priority ?? (classification ? priorityFor(classification) : "medium");
  const waitUntil = dueAt({ priority, createdAt: at, lastItResponseAt: null, reopenedAt: null });
  if (priority === "critical") return { level: "N2", reason: "critical", priority, waitUntil };
  if (ticket && isOverdue({ ...ticket, dueAt: new Date(ticket.dueAt) }, at)) return { level: "N2", reason: "overdue", priority, waitUntil };
  return { level: "N1", reason: requested, priority, waitUntil };
}
