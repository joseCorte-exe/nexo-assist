"use client";

import { LogOut } from "lucide-react";
import { useSignOut } from "@/components/use-sign-out";

export function SignOutButton() {
  const { signOut, pending } = useSignOut();
  return (
    <button
      type="button"
      onClick={signOut}
      aria-disabled={pending}
      className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-13.5 font-medium text-ink-2 transition-colors duration-150 hover:bg-desk aria-disabled:opacity-60"
    >
      <LogOut aria-hidden className="size-4 text-ink-3" />
      Sair
    </button>
  );
}
