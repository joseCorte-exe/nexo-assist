"use client";

import type { ConsoleDetail, ConsoleFilter, ConsoleListResponse } from "@nexo/shared";
import { useState, useSyncExternalStore } from "react";
import { MessageCircleIcon } from "@/components/console-icons";
import { NexoMark } from "@/components/nexo-mark";
import { useNow } from "@/lib/use-now";
import { AnalystMenu } from "./analyst-menu";
import { ConversationList } from "./conversation-list";
import { ConversationView } from "./conversation-view";
import { TicketsPanel } from "./tickets-panel";
import { useConsole } from "./use-console";

const WIDE = "(min-width: 1280px)";
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/**
 * The panel of her tickets: beside the conversation on a wide screen, unless closed; over it on a narrower one, only once
 * asked for. The server draws the wide one, as the design does.
 */
function usePanel() {
  const [choice, setChoice] = useState<"auto" | "open" | "closed">("auto");
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);
  const open = choice === "open" || (choice === "auto" && wide);
  return { open, toggle: () => setChoice(open ? "closed" : "open"), close: () => setChoice("closed") };
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
  const panel = usePanel();
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
              className="absolute top-1 left-6 grid h-4 min-w-4 place-items-center rounded-full bg-cta px-[5px] text-10 font-bold text-white tabular-nums outline-2 outline-desk"
            >
              {waiting}
            </span>
          ) : null}
        </a>
        <AnalystMenu name={analyst.name} email={analyst.email} available={state.available} />
      </nav>
      <ConversationList state={state} viewerId={analyst.id} now={now} />
      <ConversationView state={state} viewerId={analyst.id} now={now} panelOpen={panel.open} onTogglePanel={panel.toggle} />
      {open && panel.open ? <TicketsPanel state={state} conversation={open} onClose={panel.close} /> : null}
    </div>
  );
}
