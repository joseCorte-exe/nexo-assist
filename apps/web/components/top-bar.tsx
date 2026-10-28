import type { ReactNode } from "react";
import { ChevronRightIcon } from "./design-icons";

/** The 64 px bar with the breadcrumb, on top of every employee page. On a phone it leaves room for the menu. */
export function TopBar({ here, children }: { here: string; children?: ReactNode }) {
  return (
    // As in nexo.pen: 63.5 px of content plus the 1 px rule, overlapping the page by half a pixel. Everything in the
    // bar is centered on y = 31.75, which is where the design draws it.
    <header className="-mb-[0.5px] box-content flex h-[63.5px] shrink-0 items-center gap-4 border-b border-rule px-8 max-md:pr-4 max-md:pl-[60px]">
      <nav aria-label="Você está em" className="flex flex-1 items-center gap-2 text-13.5 leading-[normal] whitespace-nowrap">
        {/* On a phone the menu button takes the corner, so only the current page is named. */}
        <span className="text-ink-3 max-md:hidden">Service desk de TI</span>
        <ChevronRightIcon aria-hidden className="size-3.5 text-ink-3 max-md:hidden" />
        <span aria-current="page" className="font-semibold text-ink">
          {here}
        </span>
      </nav>
      {children}
    </header>
  );
}
