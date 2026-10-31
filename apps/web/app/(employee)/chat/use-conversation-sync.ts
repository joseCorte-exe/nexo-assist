"use client";

import type { ConversationResponse, ConversationState, PresenceResponse } from "@nexo/shared";
import { useCallback, useEffect, useRef } from "react";
import { createPoller, latestOnly } from "@/lib/poller";

/** While an analyst has the conversation, the chat reads it every 3 s (ARQUITETURA.md, section 4). */
const POLL_MS = 3_000;
/** In a hidden tab it keeps reading, slower, so the title can tell her an analyst wrote. */
const HIDDEN_POLL_MS = 15_000;
/** The chat tells the console it is open this often; the console counts it online for 45 s. */
const PRESENCE_MS = 20_000;

const pausedStates = new Set<ConversationState>(["waiting_for_analyst", "with_analyst"]);

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
  onLoaded: (saved: ConversationResponse) => void;
}) {
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const known = useRef({ conversationId, state });
  known.current = { conversationId, state };

  // A read that comes back after a newer one is not drawn over it.
  const latest = useRef(latestOnly()).current;
  const refresh = useCallback(async () => {
    const id = known.current.conversationId;
    const ticket = latest.begin();
    const query = id ? `?${new URLSearchParams({ conversationId: id })}` : "";
    const response = await fetch(`/api/conversation${query}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const saved = (await response.json()) as ConversationResponse;
    if (latest.take(ticket)) loaded.current(saved);
  }, [latest]);

  const ping = useCallback(
    async (typing: boolean) => {
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

  const paused = state !== null && pausedStates.has(state);
  useEffect(() => {
    if (!paused) return;
    const poller = createPoller({
      task: refresh,
      intervalMs: POLL_MS,
      hiddenIntervalMs: HIDDEN_POLL_MS,
      visible: () => document.visibilityState === "visible",
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") poller.runNow();
    };
    poller.start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [paused, refresh]);

  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "visible") void ping(false);
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
