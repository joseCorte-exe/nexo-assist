import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** The 64 px bar with the breadcrumb, on top of every employee page. */
export function TopBar({ here, children }: { here: string; children?: ReactNode }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-rule px-8">
      <nav aria-label="Você está em" className="flex flex-1 items-center gap-2 text-13.5 whitespace-nowrap">
        <span className="text-ink-3">Service desk de TI</span>
        <ChevronRight aria-hidden className="size-3.5 text-ink-3" />
        <span aria-current="page" className="font-semibold text-ink">
          {here}
        </span>
      </nav>
      {children}
    </header>
  );
}
