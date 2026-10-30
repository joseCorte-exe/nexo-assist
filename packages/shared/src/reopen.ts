// São Paulo has had a fixed UTC-3 since 2019; the window counts its calendar days, whatever zone the server runs in.
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A resolved ticket can be reopened for 7 calendar days, not business days (ARQUITETURA.md, section 2). */
export const REOPEN_WINDOW_DAYS = 7;

/** The calendar day in São Paulo, as a day number. */
const dayIn = (date: Date) => Math.floor((date.getTime() + SAO_PAULO_OFFSET_MS) / DAY_MS);

/** Within the window: up to 7 calendar days after the day it was resolved, the seventh day counted whole. */
export function canReopen(resolvedAt: Date, now: Date): boolean {
  return dayIn(now) - dayIn(resolvedAt) <= REOPEN_WINDOW_DAYS;
}
