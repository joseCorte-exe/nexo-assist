import { dueIn } from "./sao-paulo";

/** The deadline of a ticket in words, for the agent and the notes the chat leaves in its memory: "hoje, até 13:43", "amanhã, até 10:00" or "até 29 out, 17:05". */
export function deadlineWords(dueAt: Date, now: Date): string {
  const { days, time, day } = dueIn(dueAt, now);
  if (days <= 0) return `hoje, até ${time}`;
  if (days === 1) return `amanhã, até ${time}`;
  return `até ${day}, ${time}`;
}
