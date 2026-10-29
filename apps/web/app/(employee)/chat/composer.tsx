"use client";

import { MESSAGE_LIMIT } from "@nexo/shared";
import { type KeyboardEvent, type RefObject, useState } from "react";
import { ArrowUpIcon } from "@/components/design-icons";

type Props = {
  count: number;
  /** While the agent answers she can keep writing; only sending waits. */
  busy: boolean;
  onSend: (text: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

/** "Escreva para o Nexo…", Enviar and the counter. Enter sends, Shift+Enter breaks the line. */
export function Composer({ count, busy, onSend, inputRef }: Props) {
  const [text, setText] = useState("");

  function send() {
    const trimmed = text.trim();
    if (busy || !trimmed) return inputRef.current?.focus();
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
      className="flex flex-col gap-1.5"
    >
      <div className="field flex items-end gap-2 rounded-xl bg-white pr-1.5 pl-4 outline-1 -outline-offset-[0.5px] outline-field">
        <label htmlFor="chat-message" className="sr-only">
          Mensagem para o Nexo
        </label>
        <textarea
          id="chat-message"
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={2000}
          autoFocus
          placeholder="Escreva para o Nexo…"
          aria-describedby="chat-counter"
          className="max-h-[153px] min-w-0 flex-1 resize-none bg-transparent py-[13.5px] text-14.5 leading-[21px] text-ink outline-none [field-sizing:content] placeholder:text-ink-3 max-md:text-16"
        />
        <button
          type="submit"
          aria-disabled={busy}
          className="mb-1.5 flex h-9 shrink-0 appearance-none items-center gap-1.5 rounded-md bg-cta px-3 text-13.5 font-semibold text-white transition-[background-color,scale,opacity] duration-150 ease-out hover:bg-cta-hover active:scale-[0.96] aria-disabled:cursor-progress aria-disabled:opacity-50 aria-disabled:active:scale-100"
        >
          <ArrowUpIcon aria-hidden className="size-3.5" />
          Enviar
        </button>
      </div>
      <p id="chat-counter" className="self-end text-12.5 text-ink-3">
        {count}/{MESSAGE_LIMIT} mensagens nesta sessão
      </p>
    </form>
  );
}
