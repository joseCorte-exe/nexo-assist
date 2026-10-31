import type { DraftOperation, DraftRejection, Priority, TicketStatus } from "./domain";
import { localDay } from "./sao-paulo";
import { dueAt } from "./sla";

// When a ticket of the employee can take a follow-up or be reopened: one rule for the ticket-service, which checks it
// when she confirms, and for the agent, which checks it before drafting. Dates come as the service stores them or as
// they travel in JSON.

type When = Date | string;

/** A resolved ticket can be reopened for 7 calendar days, not business days (ARQUITETURA.md, section 2). */
export const REOPEN_WINDOW_DAYS = 7;

/** Resolved, and within the window: up to 7 calendar days in São Paulo after the day it was resolved, the seventh whole. */
export function isReopenable(ticket: { status: TicketStatus; resolvedAt: When | null }, now: Date): boolean {
  if (ticket.status !== "resolved" || ticket.resolvedAt === null) return false;
  return localDay(now) - localDay(new Date(ticket.resolvedAt)) <= REOPEN_WINDOW_DAYS;
}

/**
 * Why the ticket cannot take this change, or null when it can: a follow-up goes to an open ticket, and a reopening to
 * one resolved within the window.
 */
export function changeRefusal(
  operation: Exclude<DraftOperation, "create">,
  ticket: { status: TicketStatus; resolvedAt: When | null },
  now: Date,
): Exclude<DraftRejection, "ticket_not_found"> | null {
  if (operation === "update") return ticket.status === "resolved" ? "ticket_resolved" : null;
  if (ticket.status !== "resolved") return "ticket_not_resolved";
  return isReopenable(ticket, now) ? null : "reopen_window_closed";
}

/** The deadline of a ticket reopened now: the reopening counts as a new opening (RN-02). */
export function reopenedDueAt(ticket: { priority: Priority; createdAt: When; lastItResponseAt: When | null }, now: Date): Date {
  return dueAt({
    priority: ticket.priority,
    createdAt: new Date(ticket.createdAt),
    lastItResponseAt: ticket.lastItResponseAt === null ? null : new Date(ticket.lastItResponseAt),
    reopenedAt: now,
  });
}
