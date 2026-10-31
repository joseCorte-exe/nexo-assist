"use client";

import { type ConsoleConversation, type ConsoleFilter, conversationTag, listTime, type TagTone } from "@nexo/shared";
import { CheckCheckIcon, SearchIcon } from "@/components/console-icons";
import { avatarTone } from "@/lib/console-view";
import { initials } from "@/lib/format";
import type { ConsoleState } from "./use-console";

const FILTERS: Array<{ filter: ConsoleFilter; label: string; count?: "forYou" | "withAgent" | "mine" }> = [
  { filter: "all", label: "Todas" },
  { filter: "for_you", label: "Para você", count: "forYou" },
  { filter: "with_agent", label: "Com o agent", count: "withAgent" },
  { filter: "mine", label: "Minhas", count: "mine" },
];

/** The dot and the text of the line under each conversation, in the colors of nexo.pen. */
export const TAG_COLORS: Record<TagTone, { dot: string; text: string }> = {
  danger: { dot: "bg-danger", text: "text-danger-text" },
  warning: { dot: "bg-warning", text: "text-warning-text" },
  success: { dot: "bg-success", text: "text-ink-3" },
  primary: { dot: "bg-cta", text: "text-primary-text" },
  muted: { dot: "bg-ink-dot", text: "text-ink-3" },
};

/** The list column: title and availability, search, the four filters and the conversations. */
export function ConversationList({ state, viewerId, now }: { state: ConsoleState; viewerId: string; now: Date }) {
  const { list, filter } = state;
  return (
    <section
      aria-label="Lista de conversas"
      className="-mr-[0.5px] box-content flex h-dvh w-[379.5px] shrink-0 flex-col overflow-hidden border-r border-rule max-md:w-full max-md:data-[open=true]:hidden"
      data-open={state.selectedId !== null}
    >
      <div className="flex flex-col gap-3 px-4 pt-4 pb-2.5">
        <div className="flex items-center gap-2">
          <h1 className="flex-1 text-[20px]/[normal] font-bold tracking-[-0.3px] text-ink">Conversas</h1>
          <Availability available={state.available} onToggle={state.toggleAvailable} />
        </div>
        <label className="flex h-9 items-center gap-2.5 rounded-full bg-desk px-3 focus-within:outline-2 focus-within:outline-cta">
          <SearchIcon aria-hidden className="size-[15px] shrink-0 text-ink-3" />
          <span className="sr-only">Pesquisar conversa ou chamado</span>
          <input
            id="console-search"
            type="search"
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            placeholder="Pesquisar conversa ou chamado"
            maxLength={100}
            className="min-w-0 flex-1 bg-transparent text-13.5 text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
        <div role="group" aria-label="Filtros" className="flex gap-1">
          {FILTERS.map(({ filter: option, label, count }) => {
            const active = option === filter;
            const value = count ? list?.counts[count] : undefined;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => state.setFilter(option)}
                className="flex items-center gap-1.5 rounded-full bg-desk px-[9px] py-1.5 text-12.5 font-medium whitespace-nowrap text-ink-2 transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] aria-pressed:bg-primary-soft aria-pressed:text-primary-text"
              >
                {label}
                {value !== undefined ? (
                  <span className={`font-semibold tabular-nums ${active ? "text-primary-text" : "text-ink-3"}`}>{value}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <Items state={state} viewerId={viewerId} now={now} />
    </section>
  );
}

/** "Disponível": a switch the analyst flips; the dot on the rail follows it. */
function Availability({ available, onToggle }: { available: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={available}
      aria-label="Disponível"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-[5px] text-12.5 font-semibold whitespace-nowrap text-success-text transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.96] aria-[checked=false]:bg-desk aria-[checked=false]:text-ink-3"
    >
      <span aria-hidden className={`size-[7px] rounded-full transition-colors duration-150 ${available ? "bg-success" : "bg-ink-dot"}`} />
      {available ? "Disponível" : "Indisponível"}
    </button>
  );
}

const EMPTY: Record<ConsoleFilter, string> = {
  all: "Nenhuma conversa ainda.",
  for_you: "Ninguém esperando no seu nível agora.",
  with_agent: "O agent não está atendendo ninguém agora.",
  mine: "Você não está atendendo nenhuma conversa.",
};

function Items({ state, viewerId, now }: { state: ConsoleState; viewerId: string; now: Date }) {
  const { list } = state;
  if (!list) {
    return state.listFailed ? (
      <p role="alert" className="px-6 py-8 text-13.5 text-ink-3">
        Não foi possível carregar as conversas.{" "}
        <button type="button" onClick={() => void state.retryList()} className="font-medium text-primary-text hover:underline">
          Tentar de novo
        </button>
      </p>
    ) : (
      <ListSkeleton />
    );
  }
  if (list.conversations.length === 0) {
    return <p className="px-6 py-8 text-13.5 text-ink-3">{state.search ? `Nada encontrado para "${state.search}".` : EMPTY[state.filter]}</p>;
  }
  const selectedIndex = list.conversations.findIndex((conversation) => conversation.id === state.selectedId);
  return (
    <ul aria-label="Conversas" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      {list.conversations.map((conversation, index) => (
        <li key={conversation.id}>
          <Row
            conversation={conversation}
            selected={index === selectedIndex}
            // The rule under a line hides next to the highlighted one, whose own background is the separation.
            ruled={index !== selectedIndex && index !== selectedIndex - 1}
            viewerId={viewerId}
            now={now}
            onOpen={() => state.select(conversation.id)}
          />
        </li>
      ))}
    </ul>
  );
}

function Row({
  conversation,
  selected,
  ruled,
  viewerId,
  now,
  onOpen,
}: {
  conversation: ConsoleConversation;
  selected: boolean;
  ruled: boolean;
  viewerId: string;
  now: Date;
  onOpen: () => void;
}) {
  const { employee, preview, unread, typing, online } = conversation;
  const tone = avatarTone(employee.id);
  const tag = conversationTag(conversation, viewerId, now);
  const colors = TAG_COLORS[tag.tone];
  const fromOthers = preview && preview.author !== "employee";
  const time = listTime(conversation.lastActivityAt, now);
  return (
    <a
      href={`/console?c=${encodeURIComponent(conversation.id)}`}
      aria-current={selected ? "true" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onOpen();
      }}
      className="group flex items-center gap-3 rounded-xl p-2.5 transition-colors duration-150 hover:bg-desk/60 aria-[current]:bg-desk"
    >
      <span
        aria-hidden
        className="relative grid size-[46px] shrink-0 place-items-center rounded-full text-15.5 font-semibold"
        style={{ backgroundColor: tone.background, color: tone.text }}
      >
        {initials(employee.name)}
        {online ? (
          <span className="absolute top-[34px] left-[34px] size-[11px] rounded-full bg-success outline-2 outline-white group-aria-[current]:outline-desk" />
        ) : null}
      </span>
      <span
        className={`-mb-[0.5px] flex min-w-0 flex-1 flex-col gap-[3px] pb-2.5 ${ruled ? "border-b border-rule" : "border-b border-transparent"}`}
      >
        <span className="flex items-center gap-2">
          <span className={`flex-1 truncate text-15.5 text-ink ${unread > 0 ? "font-semibold" : "font-medium"}`}>{employee.name}</span>
          <span className={`text-12.5 ${unread > 0 ? "font-semibold text-cta" : "text-ink-3"}`}>{time}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {typing ? (
            <span className="flex-1 truncate text-13.5 text-success-text italic">digitando…</span>
          ) : (
            <>
              {fromOthers ? (
                <CheckCheckIcon aria-hidden className={`size-[15px] shrink-0 ${preview.seen ? "text-primary" : "text-ink-3"}`} />
              ) : null}
              <span className="flex-1 truncate text-13.5 text-ink-3">
                {preview ? `${preview.author === "agent" ? "Nexo: " : ""}${preview.text}` : ""}
              </span>
            </>
          )}
          {unread > 0 ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-cta px-1.5 text-11.5 font-bold text-white tabular-nums">
              <span className="sr-only">, não lidas: </span>
              {unread}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-[5px]">
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${colors.dot}`} />
          <span className={`truncate text-11.5 font-medium ${colors.text}`}>{tag.text}</span>
        </span>
      </span>
    </a>
  );
}

function ListSkeleton() {
  return (
    <div aria-label="Carregando conversas" role="status" className="delayed-appear flex flex-col gap-1 px-2">
      {[0, 1, 2, 3].map((line) => (
        <div key={line} className="flex items-center gap-3 p-2.5">
          <span className="size-[46px] rounded-full bg-desk" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-32 rounded bg-desk" />
            <span className="h-3 w-48 rounded bg-desk" />
          </span>
        </div>
      ))}
    </div>
  );
}
