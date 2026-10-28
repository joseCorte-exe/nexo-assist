import type { Priority, TicketStatus } from "./domain";

// São Paulo has had no daylight saving time since 2019, so its offset is a fixed UTC-3.
// Vercel runs in UTC, so every business-hours calculation goes through this offset explicitly.
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18;

/** Deadline of each priority. Critical counts around the clock; the others count business hours. */
export const SLA = {
  critical: { hours: 1, businessHours: false },
  high: { hours: 4, businessHours: true },
  medium: { hours: 30, businessHours: true },
  low: { hours: 50, businessHours: true },
} as const satisfies Record<Priority, { hours: number; businessHours: boolean }>;

/**
 * Adds business hours (Monday to Friday, 8h to 18h, São Paulo time, no holidays).
 * A start outside business hours begins counting at the next opening.
 */
export function addBusinessHours(start: Date, hours: number): Date {
  // Shift to São Paulo wall-clock time and use the UTC getters as local ones.
  let cursor = start.getTime() + SAO_PAULO_OFFSET_MS;
  let remaining = hours * HOUR_MS;

  while (remaining > 0) {
    cursor = toNextBusinessMoment(cursor);
    const endOfDay = withHour(cursor, DAY_END_HOUR);
    const step = Math.min(remaining, endOfDay - cursor);
    cursor += step;
    remaining -= step;
  }

  return new Date(cursor - SAO_PAULO_OFFSET_MS);
}

function toNextBusinessMoment(localMs: number): number {
  let cursor = localMs;
  for (;;) {
    const day = new Date(cursor).getUTCDay();
    const isWeekend = day === 0 || day === 6;
    if (!isWeekend && cursor < withHour(cursor, DAY_START_HOUR)) return withHour(cursor, DAY_START_HOUR);
    if (!isWeekend && cursor < withHour(cursor, DAY_END_HOUR)) return cursor;
    cursor = withHour(cursor + 24 * HOUR_MS, DAY_START_HOUR);
  }
}

function withHour(localMs: number, hour: number): number {
  const date = new Date(localMs);
  date.setUTCHours(hour, 0, 0, 0);
  return date.getTime();
}

/**
 * RN-02: the deadline counts from the last IT response or, if IT has not answered yet, from the opening.
 * An employee's follow-up does not restart it.
 */
export function dueAt(ticket: { priority: Priority; createdAt: Date; lastItResponseAt: Date | null }): Date {
  const start = ticket.lastItResponseAt ?? ticket.createdAt;
  const sla = SLA[ticket.priority];
  return sla.businessHours ? addBusinessHours(start, sla.hours) : new Date(start.getTime() + sla.hours * HOUR_MS);
}

/** Overdue: not resolved and past its deadline. */
export function isOverdue(ticket: { status: TicketStatus; dueAt: Date }, now: Date): boolean {
  return ticket.status !== "resolved" && now.getTime() > ticket.dueAt.getTime();
}
