"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The pill of the top bar: "Assistente online", or "Sem conexão" while the browser is offline. */
export function AssistantStatus() {
  // On the server the browser is assumed online, as the design shows.
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <p
      role="status"
      data-online={online}
      className="group flex shrink-0 items-center gap-[7px] rounded-full bg-[#00BD6C14] px-2.5 py-[5px] text-12.5 font-semibold whitespace-nowrap text-success-text transition-colors duration-200 data-[online=false]:bg-[#EE343B14] data-[online=false]:text-danger-text"
    >
      <span aria-hidden className="size-[7px] rounded-full bg-success group-data-[online=false]:bg-danger" />
      {online ? "Assistente online" : "Sem conexão"}
    </p>
  );
}
