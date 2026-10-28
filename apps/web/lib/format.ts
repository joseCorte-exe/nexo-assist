const DASH = "–";
const DAY_MS = 24 * 60 * 60 * 1000;

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
