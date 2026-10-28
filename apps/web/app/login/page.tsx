import type { Metadata } from "next";
import { Suspense } from "react";
import { NexoMark } from "@/components/nexo-mark";
import { LoginForm } from "./login-form";
import { LoginStats, LoginStatsSkeleton } from "./login-stats";
import { PrivacyDialog } from "./privacy-dialog";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh bg-paper">
      <Showcase />
      <main className="flex min-h-dvh min-w-0 flex-1 flex-col justify-between gap-10 px-4 py-10 sm:px-14">
        <p className="flex flex-wrap items-center justify-end gap-x-1.5 text-13.5">
          <span className="whitespace-nowrap text-ink-3">Problema para entrar?</span>
          <span className="font-semibold whitespace-nowrap text-primary-text">Ligue no ramal 4000</span>
        </p>
        <div className="flex justify-center">
          <LoginForm />
        </div>
        <footer className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 text-12.5 text-ink-3">
          <span>© 2026 Nexo · Service desk de TI</span>
          <PrivacyDialog />
        </footer>
      </main>
    </div>
  );
}

/**
 * Left panel, 800 of the design's 1440 px at any width. The logo and the pitch keep the design's 672 px column, centered;
 * the numbers at the bottom span the whole panel. Shown from 1280 px; below that the form takes the whole screen.
 */
function Showcase() {
  const column = "mx-auto w-full max-w-[672px]";
  return (
    <section
      aria-label="Nexo Assist"
      className="hidden min-h-dvh w-5/9 shrink-0 flex-col justify-between overflow-hidden bg-ink px-16 pt-10 pb-12 xl:flex"
    >
      <div className={`${column} flex items-center gap-2.5`}>
        <NexoMark size={24} color="#FFFFFF" />
        <span className="text-17 font-bold tracking-[-0.2px] whitespace-nowrap text-white">Nexo Assist</span>
      </div>

      <div className={`${column} flex flex-col gap-9`}>
        <div className="flex flex-col gap-[18px]">
          <p className="text-13.5 font-medium whitespace-nowrap text-[#FFFFFF8C]">Service desk de TI da Nexo</p>
          {/* nexo.pen says -1.2px; Pencil renders this line 8 px narrower than a browser does with that value. */}
          <h1 className="font-display text-[54px] leading-[56px] font-normal tracking-[-1.48px] text-white">
            Seu problema de TI, resolvido em uma conversa.
          </h1>
          <p className="w-[520px] max-w-full text-16 leading-[25px] text-[#FFFFFFA6]">
            Descreva o que está acontecendo. O assistente consulta seus chamados, busca na central de ajuda e chama um
            analista quando precisa.
          </p>
        </div>
        <ConversationPreview />
      </div>

      <Suspense fallback={<LoginStatsSkeleton />}>
        <LoginStats />
      </Suspense>
    </section>
  );
}

/** Illustration of a conversation, as in the design. Static: it explains the product, it is not data. */
function ConversationPreview() {
  return (
    <div aria-hidden className="flex pl-[clamp(0px,calc(100%-500px),96px)]">
      <div className="flex w-[500px] max-w-full flex-col gap-2.5 rounded-2xl bg-[#FFFFFF0A] p-[18px] outline-1 -outline-offset-[0.5px] outline-[#FFFFFF14]">
        <div className="flex justify-end">
          <p className="rounded-[12px_12px_4px_12px] bg-white px-3.5 py-[9px] text-13.5 whitespace-nowrap text-ink">
            Meu notebook não conecta na VPN. Erro 809.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1.5">
          <p className="flex items-center gap-1.5 text-12.5 whitespace-nowrap">
            <span className="font-semibold text-[#FFFFFFCC]">Nexo Assist</span>
            <span className="text-[#FFFFFF73]">consultou seus chamados · criou um chamado</span>
          </p>
          <p className="w-[380px] max-w-full rounded-[4px_12px_12px_12px] bg-[#FFFFFF14] px-3.5 py-2.5 text-13.5 leading-5 text-white">
            Pronto: abri o chamado com prioridade alta. Um analista fala com você em até 4 h úteis.
          </p>
          <p className="flex items-center gap-2 rounded-xl bg-white px-3 py-[7px] text-12.5 whitespace-nowrap">
            <span className="size-[7px] rounded-full bg-warning" />
            <span className="font-semibold text-ink">INC-20517</span>
            <span className="text-ink-3">Rede e VPN · Alta · em até 4 h</span>
          </p>
        </div>
      </div>
    </div>
  );
}
