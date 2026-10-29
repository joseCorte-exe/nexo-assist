import type { Priority, TicketStatus } from "@nexo/shared";

// The colors nexo.pen gives each status and priority. Whole class names, so Tailwind finds them.

/** The dot of a status, in the list and on the card. */
export const STATUS_DOT: Record<TicketStatus, string> = {
  waiting_for_analyst: "bg-warning",
  assigned: "bg-primary",
  in_progress: "bg-primary",
  approved: "bg-success",
  resolved: "bg-ink-faint",
};

/** The label of a status on the card, in the darker tone of its dot, so it reads on white. */
export const STATUS_TONE: Record<TicketStatus, string> = {
  waiting_for_analyst: "text-warning-text",
  assigned: "text-primary-text",
  in_progress: "text-primary-text",
  approved: "text-success-text",
  resolved: "text-ink-3",
};

export const PRIORITY_DOT: Record<Priority, string> = {
  critical: "bg-danger",
  high: "bg-warning",
  medium: "bg-ink-muted",
  low: "bg-ink-faint",
};
