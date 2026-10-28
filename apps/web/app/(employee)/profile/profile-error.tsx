"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useSignOut } from "@/components/use-sign-out";

const copy = {
  service_unavailable: {
    title: "Não conseguimos carregar seus dados",
    text: "O serviço de chamados não respondeu. Tente de novo em instantes.",
    action: "Tentar de novo",
  },
  not_found: {
    title: "Não encontramos seu cadastro",
    text: "Seu acesso pode ter mudado. Saia e entre de novo com seu e-mail corporativo.",
    action: "Sair",
  },
} as const;

/** Error state of the profile: retry when the ticket-service is down, sign out when the person is gone. */
export function ProfileError({ reason }: { reason: keyof typeof copy }) {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  const { signOut, pending: signingOut } = useSignOut();
  const { title, text, action } = copy[reason];
  const pending = retrying || signingOut;

  return (
    <section
      role="alert"
      className="flex items-start gap-4 rounded-2xl bg-white p-6 shadow-card outline-1 -outline-offset-[0.5px] outline-card-line"
    >
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[#EE343B12] text-danger-text">
        <CircleAlert className="size-[18px]" />
      </span>
      <div className="flex flex-1 flex-col gap-[3px]">
        <h2 className="text-14.5 font-semibold text-ink">{title}</h2>
        <p className="text-13.5 text-pretty text-ink-3">{text}</p>
      </div>
      <button
        type="button"
        aria-disabled={pending}
        onClick={() => (reason === "not_found" ? signOut() : startRetry(() => router.refresh()))}
        className="flex h-9 shrink-0 items-center gap-[7px] rounded-lg bg-white px-3.5 text-13.5 font-medium whitespace-nowrap text-ink-2 shadow-control outline-1 -outline-offset-[0.5px] outline-field transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96]"
      >
        {pending ? <LoaderCircle aria-hidden className="size-[15px] animate-spin" /> : null}
        {action}
      </button>
    </section>
  );
}
