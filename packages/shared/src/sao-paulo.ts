// São Paulo time, for every rule and text that counts days or says an hour. It has had no daylight saving time since
// 2019, so its offset is a fixed UTC-3; the servers run in UTC, so every calculation goes through this offset.

export const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** The wall clock of São Paulo at that moment, read with the UTC getters. */
export const wallClock = (date: Date) => new Date(date.getTime() + SAO_PAULO_OFFSET_MS);

/** The calendar day in São Paulo, as a day number: the difference of two is a count of calendar days. */
export const localDay = (date: Date) => Math.floor(wallClock(date).getTime() / DAY_MS);

export const twoDigits = (value: number) => String(value).padStart(2, "0");

/** "09:05". */
export function clockTime(date: Date): string {
  const clock = wallClock(date);
  return `${twoDigits(clock.getUTCHours())}:${twoDigits(clock.getUTCMinutes())}`;
}

/** "2 nov". */
export function dayAndMonth(date: Date): string {
  const clock = wallClock(date);
  return `${clock.getUTCDate()} ${MONTHS[clock.getUTCMonth()]}`;
}

/** When a deadline falls, counted from a moment: in how many São Paulo days, at what time and on what day. */
export function dueIn(dueAt: Date, since: Date): { days: number; time: string; day: string } {
  return { days: localDay(dueAt) - localDay(since), time: clockTime(dueAt), day: dayAndMonth(dueAt) };
}
