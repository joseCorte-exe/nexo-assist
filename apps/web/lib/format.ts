import { clockTime, dueIn, MONTHS, twoDigits, wallClock } from "@nexo/shared";

const DASH = "–";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** "8 s", "3 min", "2 h": the first-response number on the login screen. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return DASH;
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded} s`;
  if (rounded < 3600) return `${Math.round(rounded / 60)} min`;
  return `${Math.round(rounded / 3600)} h`;
}

export function formatPercent(percent: number | null): string {
  return percent === null ? DASH : `${Math.round(percent)}%`;
}

export function formatCount(count: number | null): string {
  return count === null ? DASH : String(count);
}

/** "Alterada há 42 dias", in whole days since the change. */
export function formatPasswordAge(changedAt: string | null, now: Date): string {
  if (changedAt === null) return "Nunca alterada";
  const days = Math.floor((now.getTime() - new Date(changedAt).getTime()) / DAY_MS);
  if (days <= 0) return "Alterada hoje";
  return days === 1 ? "Alterada há 1 dia" : `Alterada há ${days} dias`;
}

/** "AS" for Ana Souza: first letter of the first and the last name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * "Alta · 86%": the level in words, so the meaning never depends on color, and the number the agent recorded.
 * Under 0.6 is low, the line ARQUITETURA.md draws for an unsure agent. The percent rounds down, so a low
 * confidence never reads as 60%.
 */
export function formatConfidence(confidence: number): { level: ConfidenceLevel; text: string; percent: number } {
  // Rounded to a tenth first, so float noise (0.29 * 100 = 28.999…) does not drop a point.
  const percent = Math.floor(Math.round(confidence * 1000) / 10);
  if (confidence >= 0.8) return { level: "high", text: `Alta · ${percent}%`, percent };
  if (confidence >= 0.6) return { level: "medium", text: `Média · ${percent}%`, percent };
  return { level: "low", text: `Baixa · ${percent}%`, percent };
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

// Dates of the tickets, in São Paulo time.
const inSaoPaulo = (iso: string) => wallClock(new Date(iso));

/** "16 out": the opening date in the list of tickets. */
export function formatDay(iso: string): string {
  const local = inSaoPaulo(iso);
  return `${twoDigits(local.getUTCDate())} ${MONTHS[local.getUTCMonth()]}`;
}

/** "16 out, 14:20": when the ticket was opened, on its card. */
export function formatDayTime(iso: string): string {
  return `${formatDay(iso)}, ${clockTime(new Date(iso))}`;
}

/** "há 6 dias", counted from when the agent looked the ticket up, so the card says what the agent said. */
export function formatTimeAgo(iso: string, since: string): string {
  const elapsed = new Date(since).getTime() - new Date(iso).getTime();
  const days = Math.floor(elapsed / DAY_MS);
  if (days >= 1) return days === 1 ? "há 1 dia" : `há ${days} dias`;
  const hours = Math.floor(elapsed / HOUR_MS);
  if (hours >= 1) return hours === 1 ? "há 1 hora" : `há ${hours} horas`;
  return "agora há pouco";
}

/** "13:43", or "29 out, 10:00" when due on another day than the draft's: the "resposta até" of the draft card. */
export function formatDueTime(dueAt: string, since: string): string {
  const { days, time } = dueIn(new Date(dueAt), new Date(since));
  return days === 0 ? time : `${formatDay(dueAt)}, ${time}`;
}
