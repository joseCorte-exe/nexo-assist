"use client";

import { useChat } from "@ai-sdk/react";
import {
  apiError,
  type ChatNote,
  type ConversationResponse,
  type ConversationView,
  clockTime,
  type DraftView,
  employeeNoteLabel,
  type NexoUIMessage,
  textOf,
} from "@nexo/shared";
import { DefaultChatTransport } from "ai";
import { CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SystemNote } from "@/components/system-note";
import { THINKING_LABEL } from "@/lib/agent-actions";
import { currentDraft, lastDraftId, liveTurns, messageCount, type Turn, withSaved } from "@/lib/chat-turns";
import { firstName } from "@/lib/format";
import type { Shortcut } from "@/lib/shortcut";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";
import { AgentReply } from "./agent-reply";
import { AnalystMessage } from "./analyst-message";
import { useChatStatus } from "./chat-status";
import { Composer } from "./composer";
import { DraftCard } from "./draft-card";
import { EmptyChat } from "./empty-chat";
import { useConversationSync } from "./use-conversation-sync";
import { WaitingRow } from "./waiting-row";

/** Closer than this to the bottom, new parts keep the view pinned; farther up, she is reading and is left alone. */
const PIN_DISTANCE_PX = 80;

/**
 * The route only takes the new message, with its id: the conversation lives on the server and in the agent memory,
 * so the history is never sent back. "Tentar de novo" sends the same id, which the route answers without counting.
 */
const transport = new DefaultChatTransport<NexoUIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages }) => {
    let last = messages.length - 1;
    while (last > 0 && messages[last]?.role !== "user") last--;
    const message = messages[last];
    return { body: { id: message?.id, text: message ? textOf(message.parts) : "" } };
  },
});

const newMessageId = () => `msg-${crypto.randomUUID()}`;

/**
 * The route refused a message sent again because its reply was saved: the network only lost the response.
 * DefaultChatTransport puts the body of a refused request in the error message, so the code is read from there.
 */
function wasAlreadyAnswered(error: Error) {
  try {
    return apiError.safeParse(JSON.parse(error.message)).data?.error.code === "already_answered";
  } catch {
    return false;
  }
}

/** The note as she reads it: "Rafael Lima entrou na conversa · 10:12". */
const noteText = (note: ChatNote) => `${employeeNoteLabel(note)} · ${clockTime(new Date(note.at))}`;

/** Who reads what she writes, in the composer: the Nexo, the analyst waited for, or the one attending. */
function composerWords(conversation: ConversationView | null) {
  switch (conversation?.state) {
    case "waiting_for_analyst":
      return { placeholder: "Escreva para o analista…", label: "Mensagem para o analista" };
    case "with_analyst":
      return conversation.analyst
        ? { placeholder: `Escreva para ${firstName(conversation.analyst.name)}…`, label: `Mensagem para ${conversation.analyst.name}` }
        : { placeholder: "Escreva para o analista…", label: "Mensagem para o analista" };
    case "closed":
      return { placeholder: "Comece uma nova conversa…", label: "Mensagem para o Nexo, numa nova conversa" };
    default:
      return { placeholder: "Escreva para o Nexo…", label: "Mensagem para o Nexo" };
  }
}

export function Chat({
  initial,
  employeeName,
  shortcut,
}: {
  initial: ConversationResponse;
  employeeName: string;
  /** ⌘↵ or Ctrl ↵, decided on the server from the request. */
  shortcut: Shortcut;
}) {
  // Who answers her now, shared with the pill of the top bar.
  const { conversation, setConversation } = useChatStatus();
  // The callbacks of the chat outlive a render: they read the conversation of now.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  // How many replies in a row failed: the second one sends the employee to the phone.
  const [failures, setFailures] = useState(0);
  // The counter of the conversation as last loaded from the server; replies bring newer ones in the stream.
  const [savedCount, setSavedCount] = useState(initial.conversation?.messageCount ?? 0);
  // The drafts as last known: loaded with the conversation, then as each action of a card answered.
  const [drafts, setDrafts] = useState<Record<string, DraftView>>(() => byId(initial.drafts));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, setMessages, sendMessage, regenerate, status, clearError } = useChat<NexoUIMessage>({
    messages: initial.messages,
    transport,
    generateId: newMessageId,
    onError: (error) => {
      if (wasAlreadyAnswered(error)) return void showSavedConversation();
      setFailures((count) => count + 1);
    },
    onFinish: ({ message, isError }) => {
      if (isError) return;
      setFailures(0);
      // The first part says where the message went: a new conversation, or one an analyst has now.
      const part = message.parts.find((one) => one.type === "data-conversation");
      const transferred = message.parts.some((one) => one.type === "tool-transferToAnalyst");
      const known = conversationRef.current;
      if (part?.type === "data-conversation" && (part.data.id !== known?.id || part.data.state !== known?.state)) {
        setConversation({ ...part.data, targetLevel: null, waitUntil: null, analyst: null });
      }
      if (transferred || (part?.type === "data-conversation" && part.data.state !== "with_agent")) void sync.refresh();
    },
  });

  const paused = conversation?.state === "waiting_for_analyst" || conversation?.state === "with_analyst";
  const sync = useConversationSync({
    conversationId: conversation?.id ?? null,
    state: conversation?.state ?? null,
    onLoaded: (saved) => {
      if (saved.conversation) setConversation(saved.conversation);
      setDrafts(byId(saved.drafts));
      setSavedCount(saved.conversation?.messageCount ?? 0);
      setMessages((current) => withSaved(current, saved.messages, statusRef.current));
    },
  });

  /** The drafts as the server has them now, when a card learned it was showing an old state. */
  async function refreshDrafts() {
    const response = await fetch("/api/conversation", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setDrafts(byId(((await response.json()) as ConversationResponse).drafts));
  }

  async function showSavedConversation() {
    const response = await fetch("/api/conversation", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return setFailures((count) => count + 1);
    const saved = (await response.json()) as ConversationResponse;
    if (saved.conversation) setConversation(saved.conversation);
    setSavedCount(saved.conversation?.messageCount ?? 0);
    setDrafts(byId(saved.drafts));
    setMessages(saved.messages);
    clearError();
  }

  const statusRef = useRef(status);
  statusRef.current = status;
  const busy = status === "submitted" || status === "streaming";
  const turns = liveTurns(messages, status, { paused });
  const words = composerWords(conversation);
  const now = useNow();
  useTitleBadge(turns);
  const count = messageCount(messages, status, savedCount);
  const lastDraft = lastDraftId(messages);

  function renderDraft(shown: DraftView, key: string) {
    return (
      <DraftCard
        key={key}
        draft={currentDraft(shown, drafts, lastDraft)}
        busy={busy}
        shortcut={shortcut}
        onChange={(draft) => setDrafts((known) => ({ ...known, [draft.id]: draft }))}
        onDone={() => inputRef.current?.focus()}
        onStale={refreshDrafts}
      />
    );
  }

  function send(text: string) {
    void sendMessage({ text });
  }

  /** A click in an offer is the employee's answer: sent as her message, and the composer gets the focus back. */
  function choose(text: string) {
    send(text);
    inputRef.current?.focus();
  }

  function retry() {
    void regenerate();
    inputRef.current?.focus();
  }

  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  });

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_DISTANCE_PX;
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {turns.length === 0 ? (
          <EmptyChat name={employeeName} onPick={send} />
        ) : (
          <section
            aria-label="Conversa"
            className="mx-auto mt-auto flex w-full max-w-[856px] flex-col gap-5 px-6 pt-7 max-md:px-4 pb-1"
          >
            {turns.map((turn) =>
              turn.kind === "employee" ? (
                <EmployeeMessage key={turn.id} text={turn.text} unsent={turn.unsent} onRetry={retry} />
              ) : turn.kind === "note" ? (
                <SystemNote key={turn.id} event={turn.note.event} text={noteText(turn.note)} />
              ) : turn.kind === "analyst" ? (
                <AnalystMessage key={turn.id} turn={turn} />
              ) : (
                <AgentReply
                  key={turn.id}
                  turn={turn}
                  renderDraft={renderDraft}
                  failures={failures}
                  onRetry={retry}
                  onChoose={choose}
                />
              ),
            )}
          </section>
        )}
      </div>
      <div className="mx-auto w-full max-w-[856px] px-6 pt-2.5 max-md:px-4 pb-[18px]">
        {conversation?.state === "waiting_for_analyst" ? <WaitingRow conversation={conversation} now={now} /> : null}
        <Composer
          count={count}
          busy={busy}
          onSend={send}
          inputRef={inputRef}
          placeholder={words.placeholder}
          label={words.label}
          onTyping={(typing) => void sync.ping(typing)}
        />
      </div>
      <Announcer turn={turns.at(-1)} />
      <ConsoleAnnouncer turns={turns} />
    </main>
  );
}

function EmployeeMessage({ text, unsent, onRetry }: { text: string; unsent: boolean; onRetry: () => void }) {
  const bubble = useRef<HTMLDivElement>(null);
  useWholePixelWidth(bubble, text);
  // Lines break word by word, as nexo.pen breaks them, without moving a word down for a longer last line.
  return (
    <article aria-label="Você" className="message-enter flex flex-col items-end gap-1.5">
      <div
        ref={bubble}
        className="max-w-[520px] rounded-[12px_12px_4px_12px] bg-ink px-4 py-[11px] text-14.5 leading-[21px] wrap-anywhere whitespace-pre-line text-white">
        {text}
      </div>
      {unsent ? (
        <p role="alert" className="flex items-center gap-1.5 text-12.5 text-ink-3">
          <CircleAlert aria-hidden className="size-3 text-danger-text" />
          Não enviada.
          <button type="button" onClick={onRetry} className="font-medium text-primary-text hover:underline">
            Tentar de novo
          </button>
        </p>
      ) : null}
    </article>
  );
}


/**
 * Tells a screen reader what the agent is doing and, once, the whole answer. Never token by token:
 * the conversation itself is not a live region.
 */
function Announcer({ turn }: { turn: Turn | undefined }) {
  const [message, setMessage] = useState("");
  const agent = turn?.kind === "agent" ? turn : null;
  const running = agent?.steps.find((step) => step.state === "running");
  const key = agent ? `${agent.id}:${agent.phase}:${running?.key ?? ""}` : "";

  useEffect(() => {
    if (!agent) return;
    if (agent.phase === "thinking") setMessage(`Nexo Assist: ${THINKING_LABEL}`);
    else if (running) setMessage(`Nexo Assist: ${running.label}`);
    else if (agent.phase === "done") {
      const said = agent.blocks
        .flatMap((block) => (block.kind === "text" ? [block.text, block.replies?.question] : []))
        .filter(Boolean)
        .join(" ");
      if (said) setMessage(`Nexo Assist respondeu: ${said}`);
    }
    // Only when the phase or the running tool changes, not on every streamed word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

const byId = (drafts: DraftView[]) => Object.fromEntries(drafts.map((draft) => [draft.id, draft]));

/** The clock of the waiting row: it ticks every 30 s, so a wait that runs out says so without a reload. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** What happened with an analyst, as a screen reader says it. */
function spoken(turn: Turn): string | null {
  if (turn.kind === "analyst") return turn.messages.map((message) => `${turn.name}: ${message.text}`).join(" ");
  if (turn.kind !== "note") return null;
  const who = turn.note.analystName ?? "Um analista";
  switch (turn.note.event) {
    case "assumed":
      return turn.note.level ? `${who}, do Suporte ${turn.note.level}, entrou na conversa.` : `${who} entrou na conversa.`;
    case "released":
      return `${who} devolveu a conversa ao Nexo.`;
    case "closed":
      return `${who} encerrou o atendimento. Sua próxima mensagem começa uma nova conversa.`;
    default:
      return null;
  }
}

/** The ids of what an analyst did, message by message. */
const consoleIds = (turns: readonly Turn[]) =>
  turns.flatMap((turn) => (turn.kind === "analyst" ? turn.messages.map((message) => message.id) : turn.kind === "note" ? [turn.id] : []));

/**
 * Says, once, what arrives from the console after the chat loaded: an analyst joined, wrote, handed back or closed. Never
 * what was there on load, and never twice for the same message, however often the chat reads the conversation.
 */
function ConsoleAnnouncer({ turns }: { turns: readonly Turn[] }) {
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
function useTitleBadge(turns: readonly Turn[]) {
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
