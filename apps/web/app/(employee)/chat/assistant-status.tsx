"use client";

import { useSyncExternalStore } from "react";
import { useChatStatus } from "./chat-status";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const TONES = {
  online: { text: "Assistente online", pill: "bg-success-soft text-success-text", dot: "bg-success" },
  analyst: { text: "Analista online", pill: "bg-success-soft text-success-text", dot: "bg-success" },
  waiting: { text: "Aguardando analista", pill: "bg-warning-soft text-warning-text", dot: "bg-warning" },
  offline: { text: "Sem conexão", pill: "bg-[#EE343B14] text-danger-text", dot: "bg-danger" },
} as const;

/**
 * The pill of the top bar: who answers her now. "Assistente online" with the Nexo, "Aguardando analista" while she waits,
 * "Analista online" with one, and "Sem conexão" over all of them while the browser is offline. The chat announces the
 * changes; the pill itself is not a live region, so nothing is said twice.
 */
export function AssistantStatus() {
  // On the server the browser is assumed online, as the design shows.
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const { conversation } = useChatStatus();
  const tone = !online
    ? TONES.offline
    : conversation?.state === "waiting_for_analyst"
      ? TONES.waiting
      : conversation?.state === "with_analyst"
        ? TONES.analyst
        : TONES.online;
  return (
    <p
      data-online={online}
      className={`flex shrink-0 items-center gap-[7px] rounded-full px-2.5 py-[5px] text-12.5 font-semibold whitespace-nowrap transition-colors duration-200 ${tone.pill}`}
    >
      <span aria-hidden className={`size-[7px] rounded-full transition-colors duration-200 ${tone.dot}`} />
      {tone.text}
    </p>
  );
}
