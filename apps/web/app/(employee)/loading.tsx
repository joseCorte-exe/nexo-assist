import { MESSAGE_LIMIT } from "@nexo/shared";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { TopBar } from "@/components/top-bar";

/** The chat while the conversation loads: the same frame, the composer resting, and a note if it takes long. */
export default function AttendanceLoading() {
  return (
    <>
      <TopBar here="Atendimento" />
      <main aria-busy className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center">
          <p className="delayed-appear flex items-center gap-2 text-13.5 text-ink-3">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            Carregando a conversa…
          </p>
        </div>
        <div className="mx-auto flex w-full max-w-[856px] flex-col gap-1.5 px-6 pt-2.5 max-md:px-4 pb-[18px]">
          <div className="flex h-12 items-center gap-2 rounded-xl bg-white pr-1.5 pl-4 outline-1 -outline-offset-[0.5px] outline-field">
            <span className="flex-1 text-14.5 text-ink-3">Escreva para o Nexo…</span>
            <span className="flex h-9 items-center gap-1.5 rounded-md bg-cta px-3 text-13.5 font-semibold text-white opacity-50">
              <ArrowUp aria-hidden className="size-3.5" strokeWidth={2.25} />
              Enviar
            </span>
          </div>
          <p className="self-end text-12.5 text-ink-3 tabular-nums">–/{MESSAGE_LIMIT} mensagens nesta sessão</p>
        </div>
      </main>
    </>
  );
}
