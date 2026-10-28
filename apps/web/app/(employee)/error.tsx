"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/button";

/** Last resort for an unexpected failure in an employee page. The sidebar stays, so the person can still leave. */
export default function EmployeeError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <CircleAlert aria-hidden className="size-6 text-danger-text" />
      <h1 className="text-17 font-semibold text-ink">Algo deu errado nesta página</h1>
      <p className="max-w-sm text-14.5 text-pretty text-ink-3">Tente de novo. Se continuar, ligue no ramal 4000.</p>
      <Button variant="secondary" onClick={reset} className="mt-2 px-3.5">
        Tentar de novo
      </Button>
    </main>
  );
}
