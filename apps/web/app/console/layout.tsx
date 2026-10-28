import { MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { NexoMark } from "@/components/nexo-mark";
import { requireSession } from "@/lib/server/current-session";
import { AnalystMenu } from "./analyst-menu";

/**
 * Shell of the console: the narrow rail of the design. The conversations, the badge and the
 * availability dot come with feature 5.
 */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("analyst");

  return (
    <div className="flex h-dvh bg-paper">
      <nav aria-label="Console" className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-rule bg-desk py-4">
        <span className="grid size-10 place-items-center pb-2">
          <NexoMark size={22} color="var(--color-mark)" />
        </span>
        <a
          href="/console"
          aria-current="page"
          aria-label="Conversas"
          className="grid size-10 place-items-center rounded-xl bg-white text-ink drop-shadow-[0_1px_1px_#1B24311A]"
        >
          <MessageCircle aria-hidden className="size-[19px]" />
        </a>
        <AnalystMenu name={session.name} email={session.email} />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
