import type { ReactNode } from "react";
import { NexoMark } from "@/components/nexo-mark";
import { initials } from "@/lib/format";
import { requireSession } from "@/lib/server/current-session";
import { SidebarNav } from "./sidebar-nav";
import { SignOutButton } from "./sign-out-button";

/** Shell of the employee pages: the sidebar of the design, with the person from the session. */
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const session = await requireSession("employee");

  return (
    <div className="flex h-dvh bg-paper">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-rule px-3.5 pt-5 pb-3.5">
        <div className="flex items-center gap-2.5 px-2">
          <NexoMark size={20} color="var(--color-mark)" />
          <span className="text-16 font-bold tracking-[-0.2px] whitespace-nowrap text-ink">Nexo Assist</span>
        </div>
        <SidebarNav />
        <div className="mt-auto flex items-center gap-2.5 border-t border-rule px-2 pt-3.5 pb-1">
          <span
            aria-hidden
            className="grid size-[34px] shrink-0 place-items-center rounded-full bg-primary-soft text-12.5 font-bold text-primary-text"
          >
            {initials(session.name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-13.5 font-semibold text-ink">{session.name}</span>
            <span className="truncate text-11.5 text-ink-3">{session.email}</span>
          </div>
        </div>
        <SignOutButton />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
