"use client";

import { X } from "lucide-react";
import { useId, useRef } from "react";
import { cardSurface } from "@/components/card";

/** "Privacidade e uso de dados": a short text in a native modal (focus trap, Escape and backdrop for free). */
export function PrivacyDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-sm whitespace-nowrap transition-colors duration-150 hover:text-ink"
      >
        Privacidade e uso de dados
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        // A click on the backdrop lands on the dialog itself and closes it.
        onClick={(event) => event.target === event.currentTarget && event.currentTarget.close()}
        className={`dialog m-auto w-[440px] max-w-[calc(100vw-32px)] p-0 text-ink ${cardSurface}`}
      >
        {/* Padding lives inside, so a click on the dialog box itself only happens on the backdrop. */}
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-17 font-bold tracking-[-0.2px]">
              Privacidade e uso de dados
            </h2>
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => dialogRef.current?.close()}
              className="-m-1.5 grid size-8 place-items-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-desk hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-col gap-3 text-14.5 leading-[22px] text-pretty text-ink-2">
            <p>
              O Nexo Assist guarda suas conversas e os chamados abertos por elas para atender você e acompanhar cada
              caso.
            </p>
            <p>
              Os analistas de TI leem a conversa quando assumem o atendimento. Você só vê os seus próprios chamados.
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
