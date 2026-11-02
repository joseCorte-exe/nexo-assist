import { type AnalystLevel, clockTime, dueIn, LEVEL_LABEL, twoDigits, wallClock } from "@nexo/shared";

/**
 * The row above her composer while she waits for an analyst: who comes and until when, as the transfer promised. Once
 * the time passed with nobody in, it says so and gives her the phone, instead of a promise that no longer holds.
 */
export function waitingText(
  { waitUntil, level }: { waitUntil: string | null; level: AnalystLevel | null },
  now: Date,
): { title: string; body: string; late: boolean } {
  const team = level ? `${LEVEL_LABEL[level]} · ` : "";
  if (!waitUntil) return { title: "Um analista vai falar com você", body: `${team}Pode escrever enquanto espera`, late: false };
  const due = new Date(waitUntil);
  if (due.getTime() <= now.getTime()) {
    return {
      title: `Passou das ${clockTime(due)} e o analista ainda não entrou`,
      body: "Sua conversa continua na fila. Se for urgente, ligue no ramal 4000.",
      late: true,
    };
  }
  const { days, time } = dueIn(due, now);
  const clock = wallClock(due);
  const when = days <= 0 ? `até ${time}` : days === 1 ? `amanhã até ${time}` : `até ${twoDigits(clock.getUTCDate())}/${twoDigits(clock.getUTCMonth() + 1)}, ${time}`;
  return { title: `Um analista vai falar com você ${when}`, body: `${team}Pode escrever enquanto espera`, late: false };
}
