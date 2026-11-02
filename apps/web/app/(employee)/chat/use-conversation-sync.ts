"use client";

import { type ConversationResponse, type ConversationState, isPaused, type PresenceResponse } from "@nexo/shared";
import { useCallback, useEffect, useRef } from "react";
import { latestOnly } from "@/lib/poller";
import { usePolling } from "@/lib/use-polling";

/** While an analyst has the conversation, the chat reads it every 3 s (ARQUITETURA.md, section 4). */
const POLL_MS = 3_000;
/** In a hidden tab it keeps reading, slower, so the title can tell her an analyst wrote. */
const HIDDEN_POLL_MS = 15_000;
/** The chat tells the console it is open this often; the console counts it online for 45 s. */
const PRESENCE_MS = 20_000;


/**
 * Keeps her chat in step with the console. While an analyst has the conversation it reads it again every 3 s (15 s in
 * a hidden tab). Whatever the state, it says the chat is open, every 20 s while visible, and when she starts or stops
 * writing; the answer carries the state, so a chat with the agent learns at once that an analyst took it.
 */
export function useConversationSync({
  conversationId,
  state,
  onLoaded,
}: {
  conversationId: string | null;
  state: ConversationState | null;
  /** replace: the messages as saved, instead of merged with what the chat has. */
  onLoaded: (saved: ConversationResponse, options: { replace: boolean }) => void;
}) {
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const known = useRef({ conversationId, state });
  known.current = { conversationId, state };

  // A read that comes back after a newer one is not drawn over it.
  const latest = useRef(latestOnly()).current;
  /**
   * The one read of the conversation the chat makes: the one on screen, even closed, or with replace the active one, its
   * messages as saved (a reply the network lost). Answers whether the server answered.
   */
  const refresh = useCallback(
    async ({ replace = false }: { replace?: boolean } = {}) => {
      const id = replace ? null : known.current.conversationId;
      const ticket = latest.begin();
      const query = id ? `?${new URLSearchParams({ conversationId: id })}` : "";
      const response = await fetch(`/api/conversation${query}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return false;
      const saved = (await response.json()) as ConversationResponse;
      if (latest.take(ticket)) loaded.current(saved, { replace });
      return true;
    },
    [latest],
  );

  // The beat every 20 s repeats whether she writes, so it never turns "digitando…" off in the middle of a word.
  const writing = useRef(false);
  const ping = useCallback(
    async (typing: boolean = writing.current) => {
      writing.current = typing;
      const response = await fetch("/api/conversation/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typing }),
      }).catch(() => null);
      if (!response?.ok) return;
      const { conversation } = (await response.json()) as PresenceResponse;
      // An analyst took it, or gave it back, since the chat last looked.
      if (conversation && (conversation.id !== known.current.conversationId || conversation.state !== known.current.state)) void refresh();
    },
    [refresh],
  );

  usePolling(async () => void (await refresh()), { intervalMs: POLL_MS, hiddenIntervalMs: HIDDEN_POLL_MS, enabled: state !== null && isPaused(state) });

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") void ping();
    };
    beat();
    const timer = setInterval(beat, PRESENCE_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [ping]);

  return { refresh, ping };
}
