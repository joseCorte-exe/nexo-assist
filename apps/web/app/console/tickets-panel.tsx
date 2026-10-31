"use client";

import {
  CATEGORY_LABEL,
  type ConsoleConversation,
  clockTime,
  type PanelTicket,
  PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  type TicketStatus,
  ticketLine,
} from "@nexo/shared";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { ArrowRightLeftIcon, ArrowUpRightIcon, ChevronRightSmallIcon, HeadsetIcon, XIcon } from "@/components/console-icons";
import { panelSections, ticketEvent } from "@/lib/console-view";
import { firstName, formatDayTime } from "@/lib/format";
import type { ConsoleState } from "./use-console";

/** The dot of each status in the panel, and its label in "Desta conversa", in the colors of nexo.pen. */
const STATUS_COLORS: Record<TicketStatus, { dot: string; text: string }> = {
  waiting_for_analyst: { dot: "bg-warning", text: "text-warning-text" },
  assigned: { dot: "bg-cta", text: "text-primary-text" },
  in_progress: { dot: "bg-primary", text: "text-primary-text" },
  approved: { dot: "bg-success", text: "text-success-text" },
  resolved: { dot: "bg-ink-faint", text: "text-ink-3" },
};

type View = { kind: "summary" } | { kind: "all" } | { kind: "ticket"; id: string; from: "summary" | "all" };

/**
 * "Chamados de Ana": the ticket of this conversation, the other ones, and every one behind "Ver todos". A ticket opens in
 * the panel itself, with what she wrote in it.
 */
export function TicketsPanel({ state, conversation, onClose }: { state: ConsoleState; conversation: ConsoleConversation; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: "summary" });
  const name = firstName(conversation.employee.name);
  const { panel } = state;
  const tickets = panel?.employee.id === conversation.employee.id ? panel.tickets : null;
  const opened = view.kind === "ticket" ? tickets?.find((ticket) => ticket.id === view.id) : undefined;
  const title = `Chamados de ${name}`;

  return (
    <aside
      aria-label={title}
      className="-ml-[0.5px] box-content flex h-dvh w-[339.5px] shrink-0 flex-col overflow-hidden border-l border-rule bg-white max-xl:fixed max-xl:top-0 max-xl:right-0 max-xl:z-30 max-xl:shadow-menu max-md:w-full"
    >
      <header className="-mb-[0.5px] box-content flex h-[63.5px] shrink-0 items-center gap-2 border-b border-rule pr-3.5 pl-5">
        {view.kind !== "summary" ? (
          <button
            type="button"
            aria-label="Voltar"
            onClick={() => setView(view.kind === "ticket" && view.from === "all" ? { kind: "all" } : { kind: "summary" })}
            className="-ml-2 grid size-9 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-desk"
          >
            <ChevronLeft aria-hidden className="size-[18px]" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-15.5 font-semibold text-ink">{view.kind === "all" ? `Todos os chamados de ${name}` : title}</h2>
          <p className="text-12.5 text-ink-3 tabular-nums">
            {panel && tickets ? `${panel.open} ${panel.open === 1 ? "aberto" : "abertos"} · ${panel.closed} ${panel.closed === 1 ? "encerrado" : "encerrados"}` : " "}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Fechar ${title.toLowerCase()}`}
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-desk"
        >
          <XIcon aria-hidden className="size-[18px]" />
        </button>
      </header>
      {!tickets ? (
        <div className="flex-1 px-5 py-6">
          {state.panelFailed ? (
            <p role="alert" className="text-13.5 text-ink-3">
              Não foi possível carregar os chamados.{" "}
              <button type="button" onClick={() => void state.retryPanel()} className="font-medium text-primary-text hover:underline">
                Tentar de novo
              </button>
            </p>
          ) : (
            <p role="status" className="delayed-appear text-13.5 text-ink-3">
              Carregando os chamados…
            </p>
          )}
        </div>
      ) : opened ? (
        <TicketDetail ticket={opened} />
      ) : view.kind === "all" ? (
        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-5">
          <TicketList tickets={tickets} onOpen={(id) => setView({ kind: "ticket", id, from: "all" })} />
        </div>
      ) : (
        <Summary
          tickets={tickets}
          conversation={conversation}
          onOpen={(id) => setView({ kind: "ticket", id, from: "summary" })}
          onAll={() => setView({ kind: "all" })}
          name={name}
        />
      )}
    </aside>
  );
}

function Summary({
  tickets,
  conversation,
  onOpen,
  onAll,
  name,
}: {
  tickets: PanelTicket[];
  conversation: ConsoleConversation;
  onOpen: (id: string) => void;
  onAll: () => void;
  name: string;
}) {
  const { current, others } = panelSections(tickets, conversation.ticketId);
  const event = ticketEvent(conversation);
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-5 pt-6 pb-5">
        {current ? (
          <div role="group" aria-label="Desta conversa" className="flex flex-col gap-3">
            <h3 className="text-12.5 font-semibold text-ink-3">Desta conversa</h3>
            <div className="flex flex-col gap-3.5 rounded-xl bg-desk p-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center">
                  <span className="flex-1 text-12.5 font-medium text-ink-3">{current.id}</span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className={`size-[7px] rounded-full ${STATUS_COLORS[current.status].dot}`} />
                    <span className={`text-12.5 font-semibold ${STATUS_COLORS[current.status].text}`}>{TICKET_STATUS_LABEL[current.status]}</span>
                  </span>
                </div>
                <p className="text-15.5/[20px] font-semibold text-pretty text-ink">{current.title}</p>
                <p className="text-13.5 text-ink-3">{`${CATEGORY_LABEL[current.category]} · prioridade ${PRIORITY_LABEL[current.priority].toLowerCase()}`}</p>
              </div>
              {event ? (
                <div className="-mt-[0.5px] flex h-[28.5px] items-center gap-2 border-t border-rule pt-3">
                  {event.icon === "transfer" ? (
                    <ArrowRightLeftIcon aria-hidden className="size-[15px] shrink-0 text-ink-3" />
                  ) : (
                    <HeadsetIcon aria-hidden className="size-[15px] shrink-0 text-ink-3" />
                  )}
                  <span className="flex-1 text-13.5 text-ink-2">{event.text}</span>
                  <time dateTime={event.at} className="text-12.5 text-ink-3">
                    {clockTime(new Date(event.at))}
                  </time>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div role="group" aria-label={current ? "Outros chamados" : "Chamados"} className="flex flex-col gap-1">
          <h3 className="text-12.5 font-semibold text-ink-3">{current ? "Outros chamados" : "Chamados"}</h3>
          {others.length > 0 ? (
            <TicketList tickets={others} onOpen={onOpen} />
          ) : (
            <p className="py-3 text-13.5 text-ink-3">{current ? `${name} não tem outros chamados.` : `${name} não tem chamados.`}</p>
          )}
        </div>
      </div>
      <div className="flex px-4 pt-3 pb-4">
        <button
          type="button"
          onClick={onAll}
          className="flex h-9 flex-1 items-center justify-center gap-[7px] rounded-lg text-13.5 font-medium text-ink-2 shadow-control outline-1 -outline-offset-[0.5px] outline-field transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96]"
        >
          {`Ver todos os chamados de ${name}`}
          <ArrowUpRightIcon aria-hidden className="size-3.5 text-ink-3" />
        </button>
      </div>
    </>
  );
}

function TicketList({ tickets, onOpen }: { tickets: PanelTicket[]; onOpen: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {tickets.map((ticket, index) => (
        <li key={ticket.id}>
          <button
            type="button"
            onClick={() => onOpen(ticket.id)}
            className={`group -mb-[0.5px] flex w-full items-center gap-3 py-3 text-left ${index < tickets.length - 1 ? "border-b border-rule" : "border-b border-transparent"}`}
          >
            <span aria-hidden className={`size-[7px] shrink-0 rounded-full ${STATUS_COLORS[ticket.status].dot}`} />
            <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="truncate text-14.5 font-medium text-ink group-hover:underline">{ticket.title}</span>
              <span className="text-12.5 text-ink-3">{ticketLine(ticket)}</span>
            </span>
            <ChevronRightSmallIcon aria-hidden className="size-4 shrink-0 text-ink-3 transition-[translate] duration-150 ease-out group-hover:translate-x-0.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function TicketDetail({ ticket }: { ticket: PanelTicket }) {
  const facts: Array<[string, string]> = [
    ["Situação", ticket.assigneeName && ticket.status === "assigned" ? `${TICKET_STATUS_LABEL[ticket.status]} · ${ticket.assigneeName}` : TICKET_STATUS_LABEL[ticket.status]],
    ["Categoria", ticket.subcategory ? `${CATEGORY_LABEL[ticket.category]} › ${ticket.subcategory}` : CATEGORY_LABEL[ticket.category]],
    ["Prioridade", PRIORITY_LABEL[ticket.priority]],
    ["Aberto em", formatDayTime(ticket.createdAt)],
    ...(ticket.resolvedAt ? ([["Resolvido em", formatDayTime(ticket.resolvedAt)]] as Array<[string, string]>) : []),
  ];
  return (
    <div className="fade-enter flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-6 pb-5">
      <div className="flex flex-col gap-1.5">
        <span className="text-12.5 font-medium text-ink-3">{ticket.id}</span>
        <h3 className="text-15.5/[20px] font-semibold text-pretty text-ink">{ticket.title}</h3>
      </div>
      <p className="text-13.5 text-pretty text-ink-2">{ticket.description}</p>
      <dl className="flex flex-col">
        {facts.map(([label, value]) => (
          <div key={label} className="-mb-[0.5px] flex justify-between gap-3 border-b border-rule py-2.5 text-13.5">
            <dt className="text-ink-3">{label}</dt>
            <dd className="text-right font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
