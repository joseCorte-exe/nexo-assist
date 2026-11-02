"use client";

import {
  type ConsoleDetail,
  type ConsoleMessage,
  clockTime,
  DRAFT_COPY,
  type DraftView,
  draftLabel,
  noteLabel,
  PRIORITY_LABEL,
} from "@nexo/shared";
import { ChevronLeft, CircleAlert } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  BotIcon,
  CheckCheckIcon,
  CircleCheckBigIcon,
  EllipsisVerticalIcon,
  HandIcon,
  HeadsetIcon,
  SearchIcon,
  SendHorizontalIcon,
} from "@/components/console-icons";
import { SystemNote } from "@/components/system-note";
import { avatarTone, conversationMeta, type HistoryItem, headerMode, historyItems, takeoverBar } from "@/lib/console-view";
import { firstName, formatConfidence, initials } from "@/lib/format";
import { usePinnedScroll } from "@/lib/use-pinned-scroll";
import { useWholePixelRef } from "@/lib/use-whole-pixel-width";
import type { ConsoleState, PendingMessage } from "./use-console";

/** The pill of the header in each tone: the soft fill and the text of nexo.pen. */
const PILL = {
  danger: "bg-danger-soft text-danger-text",
  warning: "bg-warning-soft text-warning-text",
  success: "bg-success-soft text-success-text",
  primary: "bg-primary-soft text-primary-text",
  muted: "bg-desk text-ink-3",
} as const;

/** The open conversation: who, its state and actions, the history, and the bar to take it or the composer to answer. */
export function ConversationView({
  state,
  viewerId,
  now,
  panelOpen,
  onTogglePanel,
}: {
  state: ConsoleState;
  viewerId: string;
  now: Date;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const { detail } = state;
  if (!state.selectedId) {
    return (
      <main className="grid flex-1 place-items-center bg-console max-md:hidden">
        <p className="text-14.5 text-ink-3">Escolha uma conversa da lista.</p>
      </main>
    );
  }
  if (!detail || detail.conversation.id !== state.selectedId) {
    return (
      <main className="grid flex-1 place-items-center bg-console">
        {state.detailFailed ? (
          <p role="alert" className="text-14.5 text-ink-3">
            Não foi possível abrir a conversa.{" "}
            <button type="button" onClick={() => void state.retryDetail()} className="font-medium text-primary-text hover:underline">
              Tentar de novo
            </button>
          </p>
        ) : (
          <p role="status" className="delayed-appear text-14.5 text-ink-3">
            Abrindo a conversa…
          </p>
        )}
      </main>
    );
  }
  const { conversation } = detail;
  return (
    <main className="flex min-w-0 flex-1">
      <section aria-label={`Conversa com ${conversation.employee.name}`} className="flex h-dvh min-w-0 flex-1 flex-col bg-console">
        <Header detail={detail} state={state} viewerId={viewerId} panelOpen={panelOpen} onTogglePanel={onTogglePanel} />
        <History detail={detail} pending={state.pending} now={now} onRetry={(message) => void state.send(message.text, message.id)} />
        <Bottom detail={detail} state={state} viewerId={viewerId} now={now} />
      </section>
    </main>
  );
}

function Header({
  detail,
  state,
  viewerId,
  panelOpen,
  onTogglePanel,
}: {
  detail: ConsoleDetail;
  state: ConsoleState;
  viewerId: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  const { conversation } = detail;
  const tone = avatarTone(conversation.employee.id);
  const mode = headerMode(conversation, viewerId);
  // Hugging their text, on whole pixels, as nexo.pen lays them out next to each other.
  const pillRef = useWholePixelRef<HTMLParagraphElement>(mode.kind === "pill" ? mode.text : "");
  const releaseRef = useWholePixelRef<HTMLButtonElement>("Devolver ao agent");
  const closeRef = useWholePixelRef<HTMLButtonElement>("Encerrar atendimento");
  return (
    // 63.5 px and a rule straddling the edge, as the top bar of the chat.
    <header className="-mb-[0.5px] box-content flex h-[63.5px] shrink-0 items-center gap-3 border-b border-rule bg-white pr-4 pl-5 max-md:pl-2">
      <button
        type="button"
        onClick={() => state.select(null)}
        aria-label="Voltar para a lista"
        className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-desk md:hidden"
      >
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full text-14.5 font-semibold"
        style={{ backgroundColor: tone.background, color: tone.text }}
      >
        {initials(conversation.employee.name)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="truncate text-15.5 font-semibold text-ink">{conversation.employee.name}</h2>
        <p className="truncate text-12.5 text-ink-3">{conversationMeta(conversation)}</p>
      </div>
      {mode.kind === "pill" ? (
        <p ref={pillRef} className={`flex shrink-0 items-center gap-[7px] rounded-full px-[11px] py-1.5 text-12.5 font-semibold whitespace-nowrap ${PILL[mode.tone]}`}>
          <BotIcon aria-hidden className="size-3.5" />
          {mode.text}
        </p>
      ) : (
        <>
          <button
            ref={releaseRef}
            type="button"
            onClick={() => void state.act("release")}
            aria-disabled={state.acting !== null}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg pr-3 pl-2.5 text-13.5 font-medium whitespace-nowrap text-ink-2 outline-1 -outline-offset-[0.5px] outline-field transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96] aria-disabled:cursor-progress max-lg:hidden"
          >
            <BotIcon aria-hidden className="size-3.5" />
            Devolver ao agent
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={() => void state.act("close")}
            aria-disabled={state.acting !== null}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-danger-soft pr-3 pl-2.5 text-13.5 font-semibold whitespace-nowrap text-danger-text transition-[background-color,scale] duration-150 ease-out hover:bg-[#EE343B1F] active:scale-[0.96] aria-disabled:cursor-progress max-sm:size-9 max-sm:justify-center max-sm:p-0"
          >
            <CircleCheckBigIcon aria-hidden className="size-3.5 max-sm:size-4" />
            {/* On a phone the name of the person needs the room: the icon stays, the words go to the screen reader. */}
            <span className="max-sm:sr-only">Encerrar atendimento</span>
          </button>
        </>
      )}
      {mode.kind === "pill" ? (
        <button
          type="button"
          aria-label="Pesquisar conversa ou chamado"
          onClick={() => document.getElementById("console-search")?.focus()}
          className="grid size-9 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-desk max-md:hidden"
        >
          <SearchIcon aria-hidden className="size-[18px]" />
        </button>
      ) : null}
      <ConversationMenu
        name={firstName(conversation.employee.name)}
        panelOpen={panelOpen}
        onTogglePanel={onTogglePanel}
        canRelease={mode.kind === "actions"}
        onRelease={() => void state.act("release")}
      />
    </header>
  );
}

/** ⋮: the panel of her tickets, and handing back to the agent where the header has no room for its button. */
function ConversationMenu({
  name,
  panelOpen,
  onTogglePanel,
  canRelease,
  onRelease,
}: {
  name: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
  canRelease: boolean;
  onRelease: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const item = "flex w-full items-center rounded-lg px-2.5 py-2 text-left text-13.5 text-ink outline-none hover:bg-desk focus-visible:bg-desk";
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-2 transition-colors duration-150 hover:bg-desk"
      >
        <EllipsisVerticalIcon aria-hidden className="size-[18px]" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="menu-enter absolute top-[calc(100%+6px)] right-0 z-20 w-60 rounded-xl bg-white p-1.5 shadow-menu outline-1 -outline-offset-[0.5px] outline-card-line [--origin:top_right]"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              onTogglePanel();
              setOpen(false);
            }}
          >
            {panelOpen ? `Ocultar chamados de ${name}` : `Mostrar chamados de ${name}`}
          </button>
          {canRelease ? (
            <button
              type="button"
              role="menuitem"
              className={`${item} lg:hidden`}
              onClick={() => {
                onRelease();
                setOpen(false);
              }}
            >
              Devolver ao agent
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function History({
  detail,
  pending,
  now,
  onRetry,
}: {
  detail: ConsoleDetail;
  pending: PendingMessage[];
  now: Date;
  onRetry: (message: PendingMessage) => void;
}) {
  const { conversation, messages, drafts } = detail;
  const items = historyItems(messages, now);
  const scroller = usePinnedScroll<HTMLDivElement>([messages.length + pending.length, conversation.id]);
  const draftsById = new Map(drafts.map((draft) => [draft.id, draft]));
  return (
    <div ref={scroller.ref} onScroll={scroller.onScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mt-auto flex flex-col px-10 pt-5 pb-4 max-md:px-4">
        {items.map((item) => (
          <HistoryEntry key={item.key} item={item} employeeName={conversation.employee.name} summary={conversation.transferSummary} draftsById={draftsById} />
        ))}
        {pending.map((message) => (
          <article key={message.id} aria-label="Você" className="message-enter flex flex-col items-end gap-1 pt-4">
            <div className="max-w-[420px] rounded-[12px_4px_12px_12px] bg-analyst-bubble px-3 pt-2 pb-1.5 text-14.5/[21px] whitespace-pre-line text-ink opacity-80 shadow-bubble">
              {message.text}
            </div>
            {message.failed ? (
              <p role="alert" className="flex items-center gap-1.5 text-12.5 text-ink-3">
                <CircleAlert aria-hidden className="size-3 text-danger-text" />
                Não enviada.
                <button type="button" onClick={() => onRetry(message)} className="font-medium text-primary-text hover:underline">
                  Tentar de novo
                </button>
              </p>
            ) : null}
          </article>
        ))}
      </div>
      <Announcer messages={messages} employeeName={conversation.employee.name} conversationId={conversation.id} />
    </div>
  );
}

function HistoryEntry({
  item,
  employeeName,
  summary,
  draftsById,
}: {
  item: HistoryItem;
  employeeName: string;
  summary: string | null;
  draftsById: Map<string, DraftView>;
}) {
  if (item.kind === "day") {
    return (
      <div className="flex justify-center pb-1">
        <span className="rounded-full bg-day-pill px-2.5 py-1 text-12 font-medium text-ink-3">{item.label}</span>
      </div>
    );
  }
  const { message, grouped } = item;
  if (message.author === "system") {
    const text = message.note ? `${noteLabel(message.note)} · ${clockTime(new Date(message.at))}` : message.text;
    if (message.note?.event === "transferred" && summary) return <TransferNote text={text} summary={summary} />;
    return <SystemNote event={message.note?.event ?? null} text={text} className="pt-[18px] pb-1" />;
  }
  if (message.author === "employee") {
    return (
      <article aria-label={employeeName} className={`message-enter flex flex-col items-start gap-1 ${grouped ? "pt-[3px]" : "pt-4"}`}>
        <Bubble message={message} tone="employee" grouped={grouped} />
      </article>
    );
  }
  const draft = message.draftId ? draftsById.get(message.draftId) : undefined;
  const analyst = message.author === "analyst" ? message.analyst : null;
  return (
    <article aria-label={analyst ? analyst.name : "Nexo Assist"} className="message-enter flex flex-col items-end gap-1 pt-4">
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-12 font-semibold text-ink-2">{analyst ? analyst.name : "Nexo Assist"}</span>
        {analyst ? (
          <span className="rounded-md bg-success-soft px-1.5 py-px text-11 font-semibold text-success-text">
            Suporte {analyst.level}
          </span>
        ) : (
          <DecisionTag message={message} />
        )}
      </div>
      <Bubble message={message} tone={analyst ? "analyst" : "agent"} grouped={false} />
      {draft ? <DraftLine draft={draft} /> : null}
    </article>
  );
}

const BUBBLE = {
  employee: "bg-white rounded-[4px_12px_12px_12px]",
  agent: "bg-agent-bubble rounded-[12px_4px_12px_12px]",
  analyst: "bg-analyst-bubble rounded-[12px_4px_12px_12px]",
} as const;

/** The widest a bubble stays on one line, as wide as a bubble of the chat; past it, it wraps at 420 px. */
const ONE_LINE_MAX = 520;
/** The width nexo.pen gives a bubble whose text takes more than one line. */
const WRAPPED_WIDTH = 420;

/**
 * A bubble as the console draws it: the text and its time (and the double check of a reply) on one line while that fits
 * in 520 px and in the column; longer, the bubble takes its 420 px and the time drops under the text, against the right
 * edge, as nexo.pen draws both. Measured before paint, again when the column changes width.
 */
function Bubble({ message, tone, grouped }: { message: ConsoleMessage; tone: keyof typeof BUBBLE; grouped: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const bubble = ref.current;
    const column = bubble?.parentElement;
    if (!bubble || !column) return;
    const measure = () => {
      // On one line, at its natural width: does it fit the column?
      bubble.dataset.measuring = "true";
      const fits = bubble.getBoundingClientRect().width <= Math.min(ONE_LINE_MAX, column.getBoundingClientRect().width);
      delete bubble.dataset.measuring;
      setWrapped(!fits);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [message.text]);
  return (
    <div
      ref={ref}
      data-wrapped={wrapped}
      style={wrapped ? { width: WRAPPED_WIDTH, maxWidth: "100%" } : undefined}
      className={`group/bubble flex shadow-bubble data-[measuring=true]:!w-max data-[measuring=true]:!max-w-none data-[measuring=true]:!flex-row data-[wrapped=false]:items-end data-[wrapped=false]:gap-2.5 data-[wrapped=true]:flex-col data-[wrapped=true]:gap-0.5 ${BUBBLE[tone]} ${grouped ? "rounded-xl" : ""} px-3 pt-2 pb-1.5`}
    >
      <p className="text-14.5/[21px] wrap-anywhere whitespace-pre-line text-ink group-data-[measuring=true]/bubble:whitespace-pre">{message.text}</p>
      <p className="flex items-center justify-end gap-[3px] pb-px">
        <time dateTime={message.at} className="text-11 text-ink-3">
          {clockTime(new Date(message.at))}
        </time>
        {tone !== "employee" ? (
          <CheckCheckIcon aria-label={message.seen ? "Vista" : "Entregue"} className={`size-3.5 ${message.seen ? "text-primary" : "text-ink-3"}`} />
        ) : null}
      </p>
    </div>
  );
}

/** "IA", the tag of the agent: it opens what the agent recorded for that reply, so the analyst sees why it did it. */
function DecisionTag({ message }: { message: ConsoleMessage }) {
  const [open, setOpen] = useState(false);
  const record = message.decision?.record;
  const tag = "rounded-md bg-primary-soft px-1.5 py-px text-11 font-semibold text-primary-text";
  if (!record) return <span className={tag}>IA</span>;
  const confidence = formatConfidence(record.confidence);
  return (
    // A flex box, not an inline span: an inline wrapper would give the sender row the line height of the page.
    <span className="relative flex">
      <button
        type="button"
        aria-expanded={open}
        aria-label="IA: ver a decisão do agent"
        onClick={() => setOpen((current) => !current)}
        className={`${tag} transition-colors duration-150 hover:bg-[#0285F724]`}
      >
        IA
      </button>
      {open ? (
        <span
          role="note"
          className="menu-enter absolute top-[calc(100%+6px)] right-0 z-10 flex w-72 flex-col gap-1.5 rounded-xl bg-white p-3 text-12.5 text-ink-2 shadow-menu outline-1 -outline-offset-[0.5px] outline-card-line [--origin:top_right]"
        >
          <span>
            <strong className="font-semibold text-ink">Entendeu:</strong> {record.understanding}
          </span>
          <span>
            <strong className="font-semibold text-ink">Fez:</strong> {record.action}
          </span>
          <span>
            <strong className="font-semibold text-ink">Segurança:</strong> {confidence.text}
          </span>
          <span>
            <strong className="font-semibold text-ink">Por quê:</strong> {record.reason}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** The note of the transfer opens the summary the agent wrote for the analyst. */
function TransferNote({ text, summary }: { text: string; summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-center gap-2 pt-[18px] pb-1">
      {/* The note stays a separator for a screen reader; a button over it opens the summary. */}
      <div className="relative w-full">
        <SystemNote event="transferred" text={text} />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          title="Ver o resumo do agent"
          className="absolute inset-0 cursor-pointer rounded-md"
        >
          <span className="sr-only">Ver o resumo do agent</span>
        </button>
      </div>
      {open ? (
        <p className="fade-enter max-w-[520px] rounded-xl bg-white px-4 py-3 text-13.5 text-pretty text-ink-2 shadow-bubble">
          <span className="font-semibold text-ink">Resumo do agent: </span>
          {summary}
        </p>
      ) : null}
    </div>
  );
}

/** The draft the agent showed her in that reply, as it is now. */
function DraftLine({ draft }: { draft: DraftView }) {
  const copy = DRAFT_COPY[draft.operation];
  const state =
    draft.status === "confirmed" ? `${copy.done}${draft.ticketId ? ` · ${draft.ticketId}` : ""}` : draft.status === "pending" ? "Aguardando confirmação" : copy.notDone;
  return (
    <p className="max-w-[420px] rounded-lg bg-white px-3 py-1.5 text-12.5 text-ink-3 shadow-bubble">
      {copy.kind} · {draft.operation === "create" ? `Rascunho ${draftLabel(draft.number)}` : draft.ticketId} · prioridade{" "}
      {PRIORITY_LABEL[draft.priority].toLowerCase()} · <span className="font-medium text-ink-2">{state}</span>
    </p>
  );
}

function Bottom({ detail, state, viewerId, now }: { detail: ConsoleDetail; state: ConsoleState; viewerId: string; now: Date }) {
  const bar = takeoverBar(detail.conversation, viewerId, now);
  const name = firstName(detail.conversation.employee.name);
  const releaseRef = useWholePixelRef<HTMLButtonElement>("Devolver ao agent");
  const assumeRef = useWholePixelRef<HTMLButtonElement>(state.acting === "assume" ? "Assumindo…" : "Assumir atendimento");
  return (
    // 12 px above the bar that takes the conversation, 10 above the composer of who attends, as nexo.pen draws them.
    <div
      className={`-mt-[0.5px] box-content flex shrink-0 flex-col gap-2.5 border-t border-rule bg-white px-5 pb-3.5 max-md:px-3 ${bar.kind === "compose" ? "pt-2.5" : "pt-3"}`}
    >
      {state.actionError ? (
        <p role="alert" className="text-12.5 text-danger-text">
          {state.actionError}
        </p>
      ) : null}
      {bar.kind === "take" ? (
        <>
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-text">
              <HandIcon className="size-[17px]" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-14.5 font-semibold text-ink">{bar.title}</p>
              <p className="text-12.5 text-ink-3">{bar.body}</p>
            </div>
            {bar.release ? (
              <button
                ref={releaseRef}
                type="button"
                onClick={() => void state.act("release")}
                aria-disabled={state.acting !== null}
                className="flex h-9 shrink-0 items-center gap-[7px] rounded-lg pr-3.5 pl-3 text-13.5 font-medium whitespace-nowrap text-ink-2 shadow-control outline-1 -outline-offset-[0.5px] outline-field transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96] aria-disabled:cursor-progress max-md:hidden"
              >
                <BotIcon aria-hidden className="size-[15px]" />
                Devolver ao agent
              </button>
            ) : null}
            <button
              ref={assumeRef}
              type="button"
              onClick={() => void state.act("assume")}
              aria-disabled={state.acting !== null}
              className="flex h-9 shrink-0 items-center gap-[7px] rounded-lg bg-cta pr-4 pl-3.5 text-13.5 font-semibold whitespace-nowrap text-white transition-[background-color,scale] duration-150 ease-out hover:bg-cta-hover active:scale-[0.96] aria-disabled:cursor-progress"
            >
              <HeadsetIcon aria-hidden className="size-4" />
              {state.acting === "assume" ? "Assumindo…" : "Assumir atendimento"}
            </button>
          </div>
          <LockedComposer placeholder={bar.placeholder} name={name} />
        </>
      ) : bar.kind === "compose" ? (
        <Composer key={detail.conversation.id} placeholder={bar.placeholder} name={name} onSend={(text) => void state.send(text)} />
      ) : (
        <p className="flex h-11 items-center justify-center rounded-xl bg-desk text-14.5 text-ink-3">{bar.text}</p>
      )}
    </div>
  );
}

function LockedComposer({ placeholder, name }: { placeholder: string; name: string }) {
  return (
    <div className="flex h-11 items-center opacity-55">
      <label className="sr-only" htmlFor="console-locked">{`Mensagem para ${name}`}</label>
      <input id="console-locked" disabled placeholder={placeholder} className="h-11 flex-1 rounded-xl bg-desk px-3.5 text-14.5 placeholder:text-ink-3" />
    </div>
  );
}

/** The analyst's answer. Enter sends, Shift+Enter breaks the line. */
function Composer({ placeholder, name, onSend }: { placeholder: string; name: string; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      className="flex items-end gap-3"
    >
      <label htmlFor="console-message" className="sr-only">{`Mensagem para ${name}`}</label>
      <textarea
        id="console-message"
        ref={inputRef}
        rows={1}
        value={text}
        maxLength={2000}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="max-h-[153px] min-h-11 flex-1 resize-none rounded-xl bg-desk px-3.5 py-[11.5px] text-14.5/[21px] text-ink outline-none [field-sizing:content] placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-cta"
      />
      <button
        type="submit"
        aria-label="Enviar"
        className="grid size-11 shrink-0 place-items-center rounded-full bg-cta text-white transition-[background-color,scale] duration-150 ease-out hover:bg-cta-hover active:scale-[0.96]"
      >
        <SendHorizontalIcon aria-hidden className="size-[18px]" />
      </button>
    </form>
  );
}

/** Reads aloud, once, a message she sends while the conversation is open: the history itself is not a live region. */
function Announcer({ messages, employeeName, conversationId }: { messages: ConsoleMessage[]; employeeName: string; conversationId: string }) {
  const [said, setSaid] = useState("");
  const seen = useRef<{ conversationId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(messages.map((message) => message.id));
    const before = seen.current;
    seen.current = { conversationId, ids };
    if (!before || before.conversationId !== conversationId) return;
    const fresh = messages.filter((message) => message.author === "employee" && !before.ids.has(message.id));
    if (fresh.length > 0) setSaid(`${employeeName}: ${fresh.map((message) => message.text).join(" ")}`);
  }, [messages, employeeName, conversationId]);
  return (
    <p role="status" className="sr-only">
      {said}
    </p>
  );
}
