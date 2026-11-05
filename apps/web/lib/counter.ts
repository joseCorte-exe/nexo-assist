import { type ConversationState, isPaused, MESSAGE_LIMIT } from "@nexo/shared";

/** From here on, while the Nexo answers, the counter says what is left. */
export const LIMIT_WARNING_FROM = 25;

/**
 * The line under her composer: the count of the conversation; what is left in the last five, while the Nexo answers;
 * and, past the limit with an analyst, who stays with her instead of a count past 30.
 */
export type Counter = { kind: "count"; count: number } | { kind: "left"; left: number } | { kind: "analyst"; name: string | null };

export function counterOf(
  count: number,
  { state, limitReached, analystName }: { state: ConversationState; limitReached: boolean; analystName: string | null },
): Counter {
  if (limitReached && isPaused(state)) return { kind: "analyst", name: analystName };
  const left = MESSAGE_LIMIT - count;
  if (state === "with_agent" && count >= LIMIT_WARNING_FROM && left > 0) return { kind: "left", left };
  return { kind: "count", count: Math.min(count, MESSAGE_LIMIT) };
}

/** The line as words. */
export function counterWords(counter: Counter): string {
  switch (counter.kind) {
    case "count":
      return `${counter.count}/${MESSAGE_LIMIT} mensagens nesta sessão`;
    case "left":
      return counter.left === 1 ? "Resta 1 mensagem nesta sessão" : `Restam ${counter.left} mensagens nesta sessão`;
    case "analyst":
      return `Limite do Nexo atingido · ${counter.name ?? "um analista"} continua com você`;
  }
}
