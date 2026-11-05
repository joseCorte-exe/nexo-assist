"use client";

import { type ChatNote, employeeNoteLabel, LEVEL_LABEL } from "@nexo/shared";
import { useEffect, useRef, useState } from "react";
import type { Turn } from "@/lib/chat-turns";

// What reaches her chat from the console while she waits or talks with an analyst: a screen reader hears it once, and a
// hidden tab counts it in its title.

/** A note as a screen reader says it: her words, with the level of who joined and what closing means for her. */
function spokenNote(note: ChatNote): string | null {
  switch (note.event) {
    case "transferred":
      // The reply of the agent that transferred already said where to.
      return null;
    case "assumed":
      return `${employeeNoteLabel(note)}, ${LEVEL_LABEL[note.level]}.`;
    case "closed":
    case "resolved":
      return `${employeeNoteLabel(note)}. Sua próxima mensagem começa uma nova conversa.`;
    default:
      return `${employeeNoteLabel(note)}.`;
  }
}

/** What an analyst did, as a screen reader says it. */
function spoken(turn: Turn): string | null {
  if (turn.kind === "analyst") return turn.messages.map((message) => `${turn.name}: ${message.text}`).join(" ");
  return turn.kind === "note" ? spokenNote(turn.note) : null;
}

/** The ids of what an analyst did, message by message. */
const consoleIds = (turns: readonly Turn[]) =>
  turns.flatMap((turn) => (turn.kind === "analyst" ? turn.messages.map((message) => message.id) : turn.kind === "note" ? [turn.id] : []));

/**
 * Says, once, what arrives from the console after the chat loaded: an analyst joined, wrote, handed back or closed. Never
 * what was there on load, and never twice for the same message, however often the chat reads the conversation.
 */
export function ConsoleAnnouncer({ turns }: { turns: readonly Turn[] }) {
  const [message, setMessage] = useState("");
  const seen = useRef<Set<string> | null>(null);
  const key = consoleIds(turns).join(",");
  useEffect(() => {
    const ids = consoleIds(turns);
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const said = turns
      .flatMap((turn) => {
        if (turn.kind === "analyst") {
          const fresh = turn.messages.filter((one) => !known.has(one.id));
          return fresh.length > 0 ? [spoken({ ...turn, messages: fresh })] : [];
        }
        return turn.kind === "note" && !known.has(turn.id) ? [spoken(turn)] : [];
      })
      .filter(Boolean);
    for (const id of ids) known.add(id);
    if (said.length > 0) setMessage(said.join(" "));
    // Only when something from the console arrives, not on every streamed word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

/**
 * While the tab is hidden, its title counts what the analyst did meanwhile ("(2) Atendimento"), as mail and chat apps
 * do: the wait can be hours, and she should not have to keep watching. Back on the tab, the count goes.
 */
export function useTitleBadge(turns: readonly Turn[]) {
  const baseline = useRef<number | null>(null);
  const original = useRef<string | null>(null);
  const count = consoleIds(turns).length;
  useEffect(() => {
    const reset = () => {
      if (document.visibilityState !== "visible") return;
      baseline.current = null;
      if (original.current) document.title = original.current;
    };
    document.addEventListener("visibilitychange", reset);
    return () => document.removeEventListener("visibilitychange", reset);
  }, []);
  useEffect(() => {
    if (document.visibilityState === "visible") return;
    original.current ??= document.title;
    baseline.current ??= count;
    const fresh = count - baseline.current;
    if (fresh > 0) document.title = `(${fresh}) ${original.current}`;
  }, [count]);
}
