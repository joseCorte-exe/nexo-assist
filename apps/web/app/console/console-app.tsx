"use client";

import type { ConsoleDetail, ConsoleFilter, ConsoleListResponse } from "@nexo/shared";
import { useEffect, useState } from "react";
import { MessageCircleIcon } from "@/components/console-icons";
import { NexoMark } from "@/components/nexo-mark";
import { AnalystMenu } from "./analyst-menu";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { TicketsPanel } from "./tickets-panel";
import { useConsole } from "./use-console";

/** The clock of the times and waits on screen: it ticks every 30 s, so "agora" and "contato em 25 min" move on their own. */
function useNow(initial: string) {
  const [now, setNow] = useState(() => new Date(initial));
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The console of the analyst (nexo.pen, "Atendente — Conversas" and "Atendimento assumido"): the rail, the list, the open
 * conversation and the panel of her tickets.
 */
export function ConsoleApp({
  analyst,
  initial,
  renderedAt,
}: {
  analyst: { id: string; name: string; email: string };
  initial: { list: ConsoleListResponse | null; filter: ConsoleFilter; selectedId: string | null; detail: ConsoleDetail | null; available: boolean };
  renderedAt: string;
}) {
  const state = useConsole(initial);
  const now = useNow(renderedAt);
  const [panelOpen, setPanelOpen] = useState(true);
  const waiting = state.list?.waiting ?? 0;
  const open = state.detail && state.detail.conversation.id === state.selectedId ? state.detail.conversation : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      <nav aria-label="Console" className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-rule bg-desk py-4 max-md:hidden">
        <span className="grid size-10 place-items-center pb-2">
          <NexoMark size={22} color="var(--color-mark)" />
        </span>
        <a
          href="/console"
          aria-current="page"
          aria-label={waiting > 0 ? `Conversas, ${waiting} esperando atendente` : "Conversas"}
          className="relative grid size-10 place-items-center rounded-xl bg-white text-ink drop-shadow-[0_1px_1px_#1B24311A]"
        >
          <MessageCircleIcon aria-hidden className="size-[19px]" />
          {waiting > 0 ? (
            <span
              aria-hidden
              className="absolute top-1 left-6 grid h-4 min-w-4 place-items-center rounded-full bg-cta px-[5px] text-[10px]/[normal] font-bold text-white tabular-nums outline-2 outline-desk"
            >
              {waiting}
            </span>
          ) : null}
        </a>
        <AnalystMenu name={analyst.name} email={analyst.email} available={state.available} />
      </nav>
      <ConversationList state={state} viewerId={analyst.id} now={now} />
      <ConversationView state={state} viewerId={analyst.id} now={now} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((current) => !current)} />
      {open && panelOpen ? <TicketsPanel state={state} conversation={open} onClose={() => setPanelOpen(false)} /> : null}
    </div>
  );
}
