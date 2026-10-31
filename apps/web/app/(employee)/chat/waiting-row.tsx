"use client";

import type { ConversationView } from "@nexo/shared";
import { HandIcon } from "@/components/console-icons";
import { waitingText } from "@/lib/waiting";

/**
 * Above her composer while she waits for an analyst: the console's waiting row without its buttons, so the time she was
 * promised stays in sight however much she writes. It leaves as soon as an analyst joins.
 */
export function WaitingRow({ conversation, now }: { conversation: ConversationView; now: Date }) {
  const { title, body } = waitingText({ waitUntil: conversation.waitUntil, level: conversation.targetLevel }, now);
  return (
    <div className="fade-enter flex items-center gap-3 pb-2.5">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning-text">
        <HandIcon className="size-[17px]" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-14.5 font-semibold text-pretty text-ink">{title}</p>
        <p className="text-12.5 text-pretty text-ink-3">{body}</p>
      </div>
    </div>
  );
}
