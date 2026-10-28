"use client";

import { LogOut } from "lucide-react";
import type { ComponentProps } from "react";
import { useSignOut } from "./use-sign-out";

/** "Sair", in the employee sidebar and in the analyst menu (which passes role="menuitem" and its focus style). */
export function SignOutButton({ className = "", ...props }: ComponentProps<"button">) {
  const { signOut, pending } = useSignOut();
  return (
    <button
      {...props}
      type="button"
      onClick={signOut}
      aria-disabled={pending}
      className={`flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-13.5 font-medium text-ink-2 transition-colors duration-150 hover:bg-desk aria-disabled:opacity-60 ${className}`}
    >
      <LogOut aria-hidden className="size-4 text-ink-3" />
      Sair
    </button>
  );
}
