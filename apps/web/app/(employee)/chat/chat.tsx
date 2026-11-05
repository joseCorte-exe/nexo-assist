"use client";

import { useChat } from "@ai-sdk/react";
import {
  apiError,
  type ChatNote,
  isPaused,
  type ConversationResponse,
  type ConversationView,
  clockTime,
  type DraftView,
  employeeNoteLabel,
  reachedLimit,
  type NexoUIMessage,
  textOf,
} from "@nexo/shared";
import { DefaultChatTransport } from "ai";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SystemNote } from "@/components/system-note";
import { counterOf } from "@/lib/counter";
import { THINKING_LABEL } from "@/lib/agent-actions";
import { currentDraft, dayBreaks, lastDraftId, liveTurns, messageCount, type Turn, withSaved } from "@/lib/chat-turns";
import { firstName } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { usePinnedScroll } from "@/lib/use-pinned-scroll";
import type { Shortcut } from "@/lib/shortcut";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";
import { AgentReply } from "./agent-reply";
import { AnalystMessage } from "./analyst-message";
import { useChatStatus } from "./chat-status";
import { Composer } from "./composer";
import { ConsoleAnnouncer, useTitleBadge } from "./console-updates";
import { DraftCard } from "./draft-card";
import { EmptyChat } from "./empty-chat";
import { useConversationSync } from "./use-conversation-sync";
import { WaitingRow } from "./waiting-row";

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
      if (wasAlreadyAnswered(error)) return void showSavedReply();
      setFailures((count) => count + 1);
    },
    onFinish: ({ message, isError }) => {
      if (isError) return;
      setFailures(0);
      // The first part says where the message went: a new conversation, or one an analyst has now. A transfer in this
      // reply moved it after that part: the conversation is read again, with the note it left.
      const part = message.parts.find((one) => one.type === "data-conversation");
      const known = conversationRef.current;
      if (part?.type === "data-conversation" && (part.data.id !== known?.id || part.data.state !== known?.state)) setConversation(part.data);
      const transferred = message.parts.some((one) => one.type === "tool-transferToAnalyst" && one.state === "output-available" && one.output.ok);
      // The message that reached the limit was answered: the server applied the limit before this stream ended.
      // Unless the demo was unavailable: nobody answered, so it applies at her next message, and a read would take the notice away.
      const unavailable = message.parts.some((one) => one.type === "data-unavailable");
      const atLimit = !unavailable && part?.type === "data-conversation" && reachedLimit(part.data.messageCount);
      if (transferred || atLimit || (part?.type === "data-conversation" && part.data.state !== "with_agent")) void sync.refresh();
    },
  });

  const paused = conversation !== null && isPaused(conversation.state);
  const statusRef = useRef(status);
  statusRef.current = status;
  const busy = status === "submitted" || status === "streaming";
  const count = messageCount(messages, status, savedCount);
  // Everything the chat learns from the server lands here: the conversation, its counter, its drafts and its messages.
  const sync = useConversationSync({
    conversationId: conversation?.id ?? null,
    state: conversation?.state ?? null,
    onLoaded: (saved, { serverWins }) => {
      if (saved.conversation) setConversation(saved.conversation);
      setDrafts(byId(saved.drafts));
      setSavedCount(saved.conversation?.messageCount ?? 0);
      setMessages((current) => (serverWins ? saved.messages : withSaved(current, saved.messages, statusRef.current)));
    },
  });

  /** The reply was saved and only its response was lost: the conversation as saved replaces what the chat has. */
  async function showSavedReply() {
    if (!(await sync.refresh({ serverWins: true }))) return setFailures((count) => count + 1);
    clearError();
  }

  const turns = liveTurns(messages, status, { paused });
  const words = composerWords(conversation);
  const now = useNow();
  useTitleBadge(turns);
  const days = dayBreaks(messages, now);
  const counter = counterOf(count, {
    state: conversation?.state ?? "with_agent",
    limitReached: conversation?.limitReached ?? false,
    analystName: conversation?.analyst?.name ?? null,
  });
  const lastDraft = lastDraftId(messages);
  const ended = conversation?.state === "closed" && !busy;

  function renderDraft(shown: DraftView, key: string) {
    return (
      <DraftCard
        key={key}
        draft={currentDraft(shown, drafts, lastDraft)}
        busy={busy}
        shortcut={shortcut}
        onChange={(draft) => setDrafts((known) => ({ ...known, [draft.id]: draft }))}
        onDone={() => inputRef.current?.focus()}
        // A card that learned it showed an old state: the drafts as the server has them now.
        onStale={() => void sync.refresh()}
      />
    );
  }

  /**
   * A new conversation: the screen of an empty chat, with nothing asked of the server until her first message, so no empty
   * conversation is ever created. The Nexo remembers nothing of the old one, so nothing of it stays on screen.
   */
  function startOver() {
    setMessages([]);
    setDrafts({});
    setSavedCount(0);
    setFailures(0);
    setConversation(null);
    inputRef.current?.focus();
  }

  function send(text: string) {
    // Written after a conversation that ended, it opens a new one: the screen starts over with it.
    if (conversationRef.current?.state === "closed") startOver();
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

  const scroller = usePinnedScroll<HTMLDivElement>();

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller.ref} onScroll={scroller.onScroll} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {turns.length === 0 ? (
          <EmptyChat name={employeeName} onPick={send} />
        ) : (
          <section
            aria-label="Conversa"
            className="mx-auto mt-auto flex w-full max-w-[856px] flex-col gap-5 px-6 pt-7 max-md:px-4 pb-1"
          >
            {turns.map((turn) => [
              days.has(turn.id) ? <DayPill key={`day-${turn.id}`} label={days.get(turn.id)!} /> : null,
              turn.kind === "employee" ? (
                <EmployeeMessage key={turn.id} text={turn.text} unsent={turn.unsent} onRetry={retry} />
              ) : turn.kind === "note" ? (
                <SystemNote key={turn.id} note={turn.note} text={noteText(turn.note)} />
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
            ])}
            {ended ? <NewConversation onStart={startOver} /> : null}
          </section>
        )}
      </div>
      <div className="mx-auto w-full max-w-[856px] px-6 pt-2.5 max-md:px-4 pb-[18px]">
        {conversation?.state === "waiting_for_analyst" ? <WaitingRow conversation={conversation} now={now} /> : null}
        <Composer
          counter={counter}
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

/**
 * The pill that opens a day, when the conversation spans more than one: the console's, in shape and type. The console
 * draws it white on its gray desk; the chat is white, so it takes the desk gray, as the muted pills of the app.
 */
function DayPill({ label }: { label: string }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-desk px-2.5 py-1 text-12 font-medium text-ink-3">{label}</span>
    </div>
  );
}

/**
 * Under the note that ended the conversation: the way to start another, as secondary as the starters of the empty chat,
 * 16 px below the note. Writing in the composer does the same.
 */
function NewConversation({ onStart }: { onStart: () => void }) {
  return (
    <div className="fade-enter -mt-1 flex justify-center">
      <button
        type="button"
        onClick={onStart}
        className="rounded-lg bg-white px-3 py-[7px] text-13.5 font-medium text-ink outline-1 -outline-offset-[0.5px] outline-rule transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96]"
      >
        Nova conversa
      </button>
    </div>
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
