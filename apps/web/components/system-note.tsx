import type { NoteView } from "@nexo/shared";
import type { ComponentType, SVGProps } from "react";
import { ArrowRightLeftIcon, BotIcon, CircleCheckBigIcon, HeadsetIcon } from "./console-icons";

type NoteIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** The limit draws what it did: closed, transferred, or an analyst who stays (the headset of "assumiu"). */
const LIMIT_ICONS: Record<Extract<NoteView, { event: "limit_reached" }>["limit"]["then"], NoteIcon> = {
  closed: CircleCheckBigIcon,
  transferred: ArrowRightLeftIcon,
  with_analyst: HeadsetIcon,
  waiting: HeadsetIcon,
};

function iconOf(note: NoteView): NoteIcon {
  switch (note.event) {
    case "transferred":
      return ArrowRightLeftIcon;
    case "assumed":
      return HeadsetIcon;
    case "released":
      return BotIcon;
    case "closed":
      return CircleCheckBigIcon;
    case "limit_reached":
      return LIMIT_ICONS[note.limit.then];
  }
}

/**
 * A note between the messages, as nexo.pen draws it in the console: a hairline on each side of an icon and the text,
 * "Transferida para Suporte N2 · 10:05". The console and the chat of the employee draw the same one; each gives its
 * own spacing. A screen reader reads it as a separator with its text.
 */
export function SystemNote({ note, text, className = "" }: { note: NoteView | null; text: string; className?: string }) {
  const Icon = note ? iconOf(note) : null;
  return (
    <div role="separator" aria-label={text} className={`message-enter flex w-full items-center justify-center gap-3 ${className}`}>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-note-line" />
      <span aria-hidden className="flex items-center gap-1.5 text-center text-12 font-medium text-balance text-ink-3">
        {Icon ? <Icon className="size-[13px] shrink-0" /> : null}
        {/* A line that wraps keeps each "·" at the end of its line, never opening the next one. */}
        {text.replaceAll(" · ", "\u00A0· ")}
      </span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-note-line" />
    </div>
  );
}
