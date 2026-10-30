"use client";

import { useChat } from "@ai-sdk/react";
import { apiError, type ConversationResponse, type DraftView, type NexoUIMessage, textOf } from "@nexo/shared";
import { DefaultChatTransport } from "ai";
import { CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { THINKING_LABEL } from "@/lib/agent-actions";
import { currentDraft, lastDraftId, liveTurns, messageCount, type Turn } from "@/lib/chat-turns";
import type { Shortcut } from "@/lib/shortcut";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";
import { AgentReply } from "./agent-reply";
import { Composer } from "./composer";
import { DraftCard } from "./draft-card";
import { EmptyChat } from "./empty-chat";

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
    onFinish: ({ isError }) => {
      if (!isError) setFailures(0);
    },
  });

  async function showSavedConversation() {
    const response = await fetch("/api/conversation", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return setFailures((count) => count + 1);
    const saved = (await response.json()) as ConversationResponse;
    setSavedCount(saved.conversation?.messageCount ?? 0);
    setDrafts(byId(saved.drafts));
    setMessages(saved.messages);
    clearError();
  }

  const busy = status === "submitted" || status === "streaming";
  const turns = liveTurns(messages, status);
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
        <Composer count={count} busy={busy} onSend={send} inputRef={inputRef} />
      </div>
      <Announcer turn={turns.at(-1)} />
    </main>
  );
}

function EmployeeMessage({ text, unsent, onRetry }: { text: string; unsent: boolean; onRetry: () => void }) {
  const bubble = useRef<HTMLDivElement>(null);
  useWholePixelWidth(bubble, text);
  return (
    <article aria-label="Você" className="message-enter flex flex-col items-end gap-1.5">
      <div
        ref={bubble}
        className="max-w-[520px] rounded-[12px_12px_4px_12px] bg-ink px-4 py-[11px] text-14.5 leading-[21px] text-pretty wrap-anywhere whitespace-pre-line text-white">
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
