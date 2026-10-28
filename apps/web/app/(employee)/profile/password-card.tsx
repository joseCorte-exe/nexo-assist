"use client";

import { resetPasswordResponse } from "@nexo/shared";
import { CircleAlert, KeyRound, LoaderCircle, Mail, RotateCcwKey } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { Card } from "@/components/card";
import { callApi } from "@/lib/api-client";

type Strip = { kind: "info" | "sent" | "failed"; text: string };

/**
 * The password card. "Redefinir senha" sends no e-mail: the route only answers the notice
 * (ARQUITETURA.md, section 1), and the strip at the bottom of the card swaps its text for it.
 */
export function PasswordCard({ email, age }: { email: string; age: string }) {
  const [strip, setStrip] = useState<Strip>({ kind: "info", text: `Enviaremos um link de redefinição para ${email}.` });
  const [pending, setPending] = useState(false);

  async function resetPassword() {
    if (pending) return;
    setPending(true);
    const result = await callApi("POST", "/api/me/reset-password", resetPasswordResponse, { email });
    setPending(false);
    setStrip(result.ok ? { kind: "sent", text: result.data.notice } : { kind: "failed", text: result.message });
  }

  const failed = strip.kind === "failed";
  const StripIcon = failed ? CircleAlert : Mail;
  return (
    <Card as="section" aria-labelledby="password-title" className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-4 p-6">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-desk text-ink-2">
          <KeyRound className="size-[18px]" />
        </span>
        <div className="flex flex-1 flex-col gap-[3px]">
          <h2 id="password-title" className="text-14.5 font-semibold text-ink">
            Senha
          </h2>
          <p className="text-13.5 text-ink-3">{age}</p>
        </div>
        <Button variant="secondary" onClick={resetPassword} aria-disabled={pending} className="pr-3.5 pl-3">
          <span className="relative size-[15px]">
            <RotateCcwKey aria-hidden className="icon-swap absolute inset-0 size-[15px]" data-hidden={pending} />
            <LoaderCircle
              aria-hidden
              className="icon-swap absolute inset-0 size-[15px] animate-spin"
              data-hidden={!pending}
            />
          </span>
          Redefinir senha
        </Button>
      </div>
      <div className="flex items-center gap-2 border-t border-rule bg-desk px-6 pt-[11px] pb-3 text-13">
        <StripIcon aria-hidden className={`size-3.5 shrink-0 ${failed ? "text-danger-text" : "text-ink-3"}`} />
        {/* The explanation is plain text; what comes after the click is announced. */}
        <span
          key={strip.text}
          role={strip.kind === "info" ? undefined : failed ? "alert" : "status"}
          className={`menu-enter ${failed ? "text-danger-text" : "text-ink-3"}`}
        >
          {strip.text}
        </span>
      </div>
    </Card>
  );
}
