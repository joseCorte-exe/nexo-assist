"use client";

import { LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useSignOut } from "@/components/use-sign-out";
import { initials } from "@/lib/format";

/** The analyst's avatar at the bottom of the rail. It opens a small menu with who is signed in and "Sair". */
export function AnalystMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const { signOut, pending } = useSignOut();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative mt-auto">
      <button
        ref={triggerRef}
        type="button"
        aria-label={name}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className="grid size-9 place-items-center rounded-full bg-primary-soft text-12.5 font-bold text-primary-text transition-[scale] duration-150 ease-out active:scale-[0.96]"
      >
        {initials(name)}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={name}
          className="menu-enter absolute bottom-0 left-[calc(100%+12px)] z-10 w-60 rounded-xl bg-white p-1.5 shadow-menu outline-1 -outline-offset-[0.5px] outline-card-line"
        >
          <div className="flex flex-col gap-px px-2.5 pt-1.5 pb-2.5">
            <span className="truncate text-13.5 font-semibold text-ink">{name}</span>
            <span className="truncate text-11.5 text-ink-3">{email}</span>
          </div>
          <button
            ref={itemRef}
            type="button"
            role="menuitem"
            onClick={signOut}
            aria-disabled={pending}
            className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-13.5 font-medium text-ink-2 transition-colors duration-150 outline-none hover:bg-desk focus-visible:bg-desk"
          >
            <LogOut aria-hidden className="size-4 text-ink-3" />
            Sair
          </button>
        </div>
      ) : null}
    </div>
  );
}
