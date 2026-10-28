"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

const PHONE = "(max-width: 767.98px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The sidebar of the design on a desktop. On a phone it becomes a drawer, opened from a menu button in the
 * corner of the top bar, so the chat gets the whole width. It closes with Escape, a tap outside or on navigating.
 */
export function SidebarDrawer({ children }: { children: ReactNode }) {
  const phone = useSyncExternalStore(subscribe, () => window.matchMedia(PHONE).matches, () => false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A navigation from inside the drawer closes it.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        aria-expanded={open}
        aria-controls="employee-sidebar"
        onClick={() => setOpen(!open)}
        className="fixed top-3.5 left-3 z-50 grid size-9 place-items-center rounded-lg text-ink-2 transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96] md:hidden"
      >
        <span className="relative size-[18px]">
          <Menu aria-hidden className="icon-swap absolute inset-0 size-[18px]" data-hidden={open} />
          <X aria-hidden className="icon-swap absolute inset-0 size-[18px]" data-hidden={!open} />
        </span>
      </button>
      <div
        aria-hidden
        data-open={open}
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-30 bg-[#1b243166] opacity-0 transition-opacity duration-200 ease-out pointer-events-none data-[open=true]:pointer-events-auto data-[open=true]:opacity-100 md:hidden"
      />
      <aside
        id="employee-sidebar"
        data-open={open}
        inert={phone && !open}
        className="flex w-[232px] shrink-0 flex-col border-r border-rule bg-paper px-3.5 pt-5 pb-3.5 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:pt-16 max-md:shadow-menu max-md:transition-transform max-md:duration-200 max-md:ease-out max-md:data-[open=false]:-translate-x-full motion-reduce:transition-none"
      >
        {children}
      </aside>
    </>
  );
}
