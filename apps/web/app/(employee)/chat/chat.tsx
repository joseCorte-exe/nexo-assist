"use client";

import { useChat } from "@ai-sdk/react";
import type { ConversationResponse } from "@nexo/shared";
import { DefaultChatTransport } from "ai";
import { CircleAlert } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ACTION_LABELS, THINKING_LABEL } from "@/lib/agent-actions";
import type { NexoUIMessage } from "@/lib/chat-message";
import { type AgentTurn, liveTurns, type Turn, turnsFromHistory } from "@/lib/chat-turns";
import { AgentReply } from "./agent-reply";
import { Composer } from "./composer";
import { EmptyChat } from "./empty-chat";

/** Closer than this to the bottom, new parts keep the view pinned; farther up, she is reading and is left alone. */
const PIN_DISTANCE_PX = 80;

const textOf = (message: NexoUIMessage | undefined) =>
  message?.parts.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";

/**
 * The route only takes the new text: the conversation lives on the server and in the agent memory,
 * so the history is never sent back.
 */
const transport = new DefaultChatTransport<NexoUIMessage>({
  api: "/api/chat",
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { text: textOf([...messages].reverse().find((message) => message.role === "user")) },
  }),
});

type Failure = { kind: "network" | "agent"; count: number };

export function Chat({ initial, employeeName }: { initial: ConversationResponse; employeeName: string }) {
  const history = useMemo(() => turnsFromHistory(initial.messages), [initial.messages]);
  const [count, setCount] = useState(initial.conversation?.messageCount ?? 0);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Whether the server took the message of the current request (it answers data-conversation first).
  const accepted = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, regenerate, status } = useChat<NexoUIMessage>({
    transport,
    onData: (part) => {
      if (part.type !== "data-conversation") return;
      accepted.current = true;
      setCount(part.data.messageCount);
    },
    onError: (error) => {
      const network = !accepted.current && (error instanceof TypeError || !navigator.onLine);
      // A message the server never took does not count.
      if (!accepted.current) setCount((current) => Math.max(0, current - 1));
      accepted.current = true;
      setFailure((previous) => ({ kind: network ? "network" : "agent", count: (previous?.count ?? 0) + 1 }));
    },
    onFinish: ({ isError }) => {
      if (!isError) setFailure(null);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const live = liveTurns(messages, status);
  // A message that never reached the server has no reply to show: the note goes under the message instead.
  const unsent = failure?.kind === "network" && live.at(-1)?.kind === "agent" && (live.at(-1) as AgentTurn).phase === "failed";
  const turns: Turn[] = [...history, ...(unsent ? live.slice(0, -1) : live)];

  function send(text: string) {
    accepted.current = false;
    setCount((current) => current + 1);
    void sendMessage({ text });
  }

  function retry() {
    // Sent again, the same text is answered without being counted twice (the route recognizes it).
    accepted.current = true;
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
            {turns.map((turn, index) =>
              turn.kind === "employee" ? (
                <EmployeeMessage key={turn.id} text={turn.text} unsent={unsent && index === turns.length - 1} onRetry={retry} />
              ) : (
                <AgentReply key={turn.id} turn={turn} failures={failure?.count ?? 0} onRetry={retry} />
              ),
            )}
          </section>
        )}
      </div>
      <div className="mx-auto w-full max-w-[856px] px-6 pt-2.5 max-md:px-4 pb-[18px]">
        <Composer count={count} busy={busy} onSend={send} inputRef={inputRef} />
      </div>
      <Announcer turn={live.at(-1)} />
    </main>
  );
}

function EmployeeMessage({ text, unsent, onRetry }: { text: string; unsent: boolean; onRetry: () => void }) {
  return (
    <article aria-label="Você" className="message-enter flex flex-col items-end gap-1.5">
      <div className="max-w-[520px] rounded-[12px_12px_4px_12px] bg-ink px-4 py-[11px] text-14.5 leading-[21px] text-pretty wrap-anywhere whitespace-pre-line text-white">
        {text}
      </div>
      {unsent ? (
        <p role="alert" className="flex items-center gap-1.5 text-12.5 text-ink-3">
          <CircleAlert aria-hidden className="size-3 text-danger-text" />
          Não enviada. Verifique sua conexão.
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
