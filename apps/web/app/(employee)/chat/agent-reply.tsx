"use client";

import { Check, ChevronDown, CircleAlert, LoaderCircle } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ACTION_LABELS, THINKING_LABEL } from "@/lib/agent-actions";
import type { AgentTurn, Decision, Step } from "@/lib/chat-turns";
import { formatConfidence } from "@/lib/format";

/** The 600 px agent bubble of nexo.pen: square top-left corner, hairline instead of a shadow. */
const bubble =
  "w-[600px] max-w-full rounded-[4px_12px_12px_12px] bg-white px-4 py-3 outline-1 -outline-offset-[0.5px] outline-rule";

type Props = {
  turn: AgentTurn;
  /** How many replies in a row failed: the second one sends the employee to the phone. */
  failures: number;
  onRetry: () => void;
};

/**
 * One reply of the agent: who answered, the actions it took (the line grows while tools run), "Ver decisão"
 * with what it understood, did, how sure it was and why, and the answer. Failures show where the answer would be.
 */
export function AgentReply({ turn, failures, onRetry }: Props) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const articleRef = useRef<HTMLElement>(null);
  const busy = turn.phase === "thinking" || turn.phase === "working" || turn.phase === "writing";
  const confidence = turn.decision ? formatConfidence(turn.decision.confidence) : null;

  function toggle() {
    setOpen(!open);
    // Opening the last reply must not hide the record under the composer.
    if (!open) requestAnimationFrame(() => articleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  return (
    <article ref={articleRef} aria-label="Nexo Assist" aria-busy={busy} className="message-enter flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-12.5 font-semibold whitespace-nowrap text-ink">Nexo Assist</span>
        {turn.phase === "thinking" ? <Action label={THINKING_LABEL} state="running" /> : null}
        {turn.steps.map((step, index) => (
          <Action key={`${step.tool}-${index}`} label={ACTION_LABELS[step.tool][step.state]} state={step.state} />
        ))}
        {confidence?.level === "low" ? (
          <span className="text-12.5 whitespace-nowrap text-warning-text">· confiança {confidence.percent}%</span>
        ) : null}
        {turn.decision ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={toggle}
            className="group -my-[4.5px] flex items-center gap-1 rounded py-[4.5px] text-12.5 font-medium whitespace-nowrap text-primary-text decoration-1 underline-offset-2 hover:underline"
          >
            Ver decisão
            <ChevronDown
              aria-hidden
              className="size-3 transition-transform duration-200 ease-out group-aria-expanded:rotate-180"
            />
          </button>
        ) : null}
      </div>

      {turn.decision ? <DecisionDetail id={detailId} open={open} decision={turn.decision} /> : null}

      {turn.text ? (
        <div className={`${bubble} mt-1.5 text-14.5 leading-[22px] text-pretty whitespace-pre-line text-ink`}>
          {turn.text}
        </div>
      ) : null}

      {turn.phase === "failed" ? (
        <div role="alert" className={`${bubble} mt-1.5 flex items-center gap-3`}>
          <CircleAlert aria-hidden className="size-3.5 shrink-0 text-danger-text" />
          <p className="flex-1 text-14.5 leading-[22px] text-pretty text-ink">
            {failures > 1
              ? "O Nexo não conseguiu responder de novo. Se continuar, ligue no ramal 4000."
              : "O Nexo não conseguiu responder."}
          </p>
          <Button variant="secondary" onClick={onRetry} className="px-3.5">
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {turn.phase === "interrupted" ? (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-12.5 text-ink-3">
          <CircleAlert aria-hidden className="size-3 text-danger-text" />
          Resposta interrompida.
          <button type="button" onClick={onRetry} className="font-medium text-primary-text hover:underline">
            Tentar de novo
          </button>
        </p>
      ) : null}
    </article>
  );
}

/** An item of the action line: a spinner while the tool runs, a check when it is done, an alert when it failed. */
function Action({ label, state }: { label: string; state: Step["state"] }) {
  const failed = state === "failed";
  return (
    <span
      className={`step-enter flex items-center gap-[5px] text-12.5 whitespace-nowrap ${failed ? "text-warning-text" : "text-ink-3"}`}
    >
      <span className="relative size-3 shrink-0">
        {failed ? (
          <CircleAlert aria-hidden className="absolute inset-0 size-3" />
        ) : (
          <>
            <LoaderCircle
              aria-hidden
              className="icon-swap absolute inset-0 size-3 animate-spin"
              data-hidden={state !== "running"}
            />
            <Check aria-hidden className="icon-swap absolute inset-0 size-3" data-hidden={state === "running"} />
          </>
        )}
      </span>
      {label}
    </span>
  );
}

/** The record of the decision, opened from the action line. Rows without a value (the reduced record) are left out. */
function DecisionDetail({ id, open, decision }: { id: string; open: boolean; decision: Decision }) {
  const confidence = formatConfidence(decision.confidence);
  const rows: Array<[string, string, string?]> = [
    ["Entendimento", decision.understanding],
    ["Ação", decision.action],
    ["Confiança", confidence.text, confidence.level === "low" ? "text-warning-text" : confidence.level === "none" ? "text-ink-3" : undefined],
    ["Motivo", decision.reason ?? ""],
  ];

  return (
    <div id={id} data-open={open} className="decision-panel" inert={!open}>
      <div className="overflow-hidden">
        <dl className="mt-1.5 grid w-[600px] max-w-full grid-cols-[88px_1fr] gap-x-3 gap-y-2 rounded-lg bg-desk px-4 py-3">
          {rows
            .filter(([, value]) => value)
            .map(([label, value, tone]) => (
              <div key={label} className="contents">
                <dt className="text-12.5 leading-5 text-ink-3">{label}</dt>
                <dd className={`text-13.5 leading-5 text-pretty ${tone ?? "text-ink"}`}>{value}</dd>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}
