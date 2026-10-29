"use client";

import { type RefObject, useRef } from "react";
import type { OfferMode } from "@/lib/chat-turns";
import { useWholePixelWidth } from "@/lib/use-whole-pixel-width";

type Props = {
  options: string[];
  chosen: string | null;
  mode: OfferMode;
  onChoose: (text: string) => void;
};

/**
 * The quick replies of nexo.pen, under the text of the last bubble. A click sends the reply as the employee's
 * message. Once answered they stay as history, the chosen one marked as in "Chat — Novo chamado".
 */
export function QuickReplies({ options, chosen, mode, onChoose }: Props) {
  return (
    <div role="group" aria-label="Respostas rápidas" className="flex flex-wrap gap-x-1.5 gap-y-2.5">
      {options.map((option) => (
        <Chip key={option} option={option} chosen={option === chosen} mode={mode} onChoose={onChoose} />
      ))}
    </div>
  );
}

const chip = "relative rounded-lg px-3 py-[7px] text-13.5 font-medium whitespace-nowrap outline-1 -outline-offset-[0.5px]";
const idle = "bg-white text-ink outline-rule";
const picked = "bg-primary-soft text-primary-text outline-primary";

function Chip({ option, chosen, mode, onChoose }: { option: string; chosen: boolean; mode: OfferMode; onChoose: (text: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useWholePixelWidth(ref, option);

  if (mode === "answered") {
    return (
      <span ref={ref as RefObject<HTMLSpanElement>} className={`${chip} ${chosen ? picked : idle}`}>
        {option}
        {chosen ? <span className="sr-only">, sua escolha</span> : null}
      </span>
    );
  }
  return (
    <button
      ref={ref as RefObject<HTMLButtonElement>}
      type="button"
      aria-disabled={mode === "busy" || undefined}
      onClick={() => mode === "open" && onChoose(option)}
      // The hit area reaches 40 px above and below the 31 px chip, without the areas of two wrapped rows meeting.
      className={`${chip} ${idle} transition-[background-color,scale] duration-150 ease-out after:absolute after:inset-x-0 after:-inset-y-[4.5px] aria-disabled:cursor-progress ${
        mode === "open" ? "hover:bg-desk active:scale-[0.96] active:bg-primary-soft" : ""
      }`}
    >
      {option}
    </button>
  );
}
