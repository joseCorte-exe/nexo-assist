// The deadline of a ticket in words, for the agent and for the notes the chat leaves in its memory. São Paulo time,
// fixed at UTC-3 since 2019, whatever zone the server runs in.
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const local = (date: Date) => new Date(date.getTime() + SAO_PAULO_OFFSET_MS);
const twoDigits = (value: number) => String(value).padStart(2, "0");

/** "hoje, até 13:43", "amanhã, até 10:00" or "até 29 out, 17:05", counted from now. */
export function deadlineWords(dueAt: Date, now: Date): string {
  const due = local(dueAt);
  const time = `${twoDigits(due.getUTCHours())}:${twoDigits(due.getUTCMinutes())}`;
  const days = Math.floor(due.getTime() / DAY_MS) - Math.floor(local(now).getTime() / DAY_MS);
  if (days <= 0) return `hoje, até ${time}`;
  if (days === 1) return `amanhã, até ${time}`;
  return `até ${due.getUTCDate()} ${MONTHS[due.getUTCMonth()]}, ${time}`;
}
