"use client";

import { useRef } from "react";
import type { AnalystTurn } from "@/lib/chat-turns";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";

/**
 * Messages of an analyst in her chat: on the left, where the Nexo answers, under the analyst's name and level, in the
 * green bubble the console gives an analyst. Several in a row share one sign.
 */
export function AnalystMessage({ turn }: { turn: AnalystTurn }) {
  return (
    <article aria-label={`${turn.name}, Suporte ${turn.level}`} className="message-enter flex flex-col items-start">
      <div className="flex items-center gap-1.5">
        <span className="text-12.5 font-semibold whitespace-nowrap text-ink">{turn.name}</span>
        <span className="rounded-md bg-success-soft px-1.5 py-px text-11 font-semibold text-success-text">Suporte {turn.level}</span>
      </div>
      {turn.messages.map((message) => (
        <Bubble key={message.id} text={message.text} />
      ))}
    </article>
  );
}

function Bubble({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useWholePixelWidth(ref, text);
  return (
    <div
      ref={ref}
      className="mt-1.5 w-fit max-w-[min(520px,100%)] rounded-[4px_12px_12px_12px] bg-analyst-bubble px-4 py-[11px] text-14.5 leading-[21px] wrap-anywhere whitespace-pre-line text-ink"
    >
      {text}
    </div>
  );
}
