"use client";

import { useChat } from "@ai-sdk/react";
import type { ConversationResponse, NexoUIMessage } from "@nexo/shared";
import { DefaultChatTransport } from "ai";
import { CircleAlert } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ACTION_LABELS, THINKING_LABEL } from "@/lib/agent-actions";
import { liveTurns, messageCount, type Turn } from "@/lib/chat-turns";
import { AgentReply } from "./agent-reply";
import { Composer } from "./composer";
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
    const text = message?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";
    return { body: { id: message?.id, text } };
  },
});

const newMessageId = () => `msg-${crypto.randomUUID()}`;

export function Chat({ initial, employeeName }: { initial: ConversationResponse; employeeName: string }) {
  // How many replies in a row failed: the second one sends the employee to the phone.
  const [failures, setFailures] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, regenerate, status } = useChat<NexoUIMessage>({
    messages: initial.messages,
    transport,
    generateId: newMessageId,
    onError: () => setFailures((count) => count + 1),
    onFinish: ({ isError }) => {
      if (!isError) setFailures(0);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const turns = liveTurns(messages, status);
  const count = messageCount(messages, status, initial.conversation?.messageCount ?? 0);

  function send(text: string) {
    void sendMessage({ text });
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
                <AgentReply key={turn.id} turn={turn} failures={failures} onRetry={retry} />
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
 * The bubble hugs its text and sits against the right edge, so a fractional text width puts its left edge, and the
 * text, between two pixels, which blurs the glyphs differently from nexo.pen. Rounding the width up to a whole pixel
 * keeps the text on the pixel grid without changing how it wraps.
 */
function useWholePixelWidth(ref: RefObject<HTMLElement | null>, content: string) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const snap = () => {
      element.style.width = "";
      element.style.width = `${Math.ceil(element.getBoundingClientRect().width)}px`;
    };
    snap();
    // The width depends on the font and the window: measure again once the font is in and on every resize.
    void document.fonts.ready.then(snap);
    window.addEventListener("resize", snap);
    return () => window.removeEventListener("resize", snap);
  }, [ref, content]);
}

/**
 * Tells a screen reader what the agent is doing and, once, the whole answer. Never token by token:
 * the conversation itself is not a live region.
 */
function Announcer({ turn }: { turn: Turn | undefined }) {
  const [message, setMessage] = useState("");
  const agent = turn?.kind === "agent" ? turn : null;
  const running = agent?.steps.find((step) => step.state === "running");
  const key = agent ? `${agent.id}:${agent.phase}:${running?.tool ?? ""}` : "";

  useEffect(() => {
    if (!agent) return;
    if (agent.phase === "thinking") setMessage(`Nexo Assist: ${THINKING_LABEL}`);
    else if (running) setMessage(`Nexo Assist: ${ACTION_LABELS[running.tool].running}`);
    else if (agent.phase === "done" && agent.text) setMessage(`Nexo Assist respondeu: ${agent.text}`);
    // Only when the phase or the running tool changes, not on every streamed word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}
