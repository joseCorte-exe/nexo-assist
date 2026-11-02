"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { initials } from "@/lib/format";

/**
 * The analyst's avatar at the bottom of the rail, with the green dot while available. It opens a small menu with who is
 * signed in and "Sair".
 */
export function AnalystMenu({ name, email, available }: { name: string; email: string; available: boolean }) {
  const [open, setOpen] = useState(false);
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
        className="relative grid size-9 place-items-center rounded-full bg-primary-soft text-12.5 font-bold text-primary-text transition-[scale] duration-150 ease-out active:scale-[0.96]"
      >
        {initials(name)}
        {available ? (
          <span aria-hidden className="absolute top-[26px] left-[26px] size-2.5 rounded-full bg-success outline-2 outline-desk" />
        ) : null}
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
          <SignOutButton ref={itemRef} role="menuitem" className="outline-none focus-visible:bg-desk" />
        </div>
      ) : null}
    </div>
  );
}
