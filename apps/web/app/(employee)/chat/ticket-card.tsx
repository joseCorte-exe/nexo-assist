import type { ReactNode } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, statusText, type TicketCard as Ticket } from "@nexo/shared";
import { firstName, formatDayTime, formatTimeAgo } from "@/lib/format";
import { PRIORITY_DOT, STATUS_DOT, STATUS_TONE } from "@/lib/ticket-look";

const dot = "size-1.5 shrink-0 rounded-full";

/**
 * The card of a ticket, as the agent looked it up: the "Ticket Card" of nexo.pen. Under 560 px of column the four
 * fields go two by two and the status drops under the number.
 */
export function TicketCard({ ticket }: { ticket: Ticket }) {
  const category = ticket.subcategory
    ? `${CATEGORY_LABEL[ticket.category]} › ${ticket.subcategory}`
    : CATEGORY_LABEL[ticket.category];
  const assignee = ticket.assigneeName ? firstName(ticket.assigneeName) : null;

  return (
    <section
      aria-label={`Chamado ${ticket.id}`}
      className="@container mt-1.5 w-full overflow-hidden rounded-2xl bg-white shadow-card outline-1 -outline-offset-[0.5px] outline-card-line"
    >
      <div className="flex flex-col gap-1.5 px-[18px] pt-4 pb-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-0.5">
          <span className="text-12.5 font-medium whitespace-nowrap text-ink-3">Chamado</span>
          <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-rule" />
          <span className="text-12.5 whitespace-nowrap text-ink-3">{ticket.id}</span>
          <span className="flex-1" />
          <span className="flex items-center gap-1.5 @max-[560px]:basis-full">
            <span aria-hidden className={`${dot} ${STATUS_DOT[ticket.status]}`} />
            <span className={`text-12.5 font-medium ${STATUS_TONE[ticket.status]}`}>
              {statusText(ticket.status, assignee)}
            </span>
          </span>
        </div>
        <h3 className="text-18 font-semibold tracking-[-0.2px] text-balance text-ink">{ticket.title}</h3>
        <p className="text-13.5 leading-5 text-pretty text-ink-2">{ticket.description}</p>
      </div>

      <dl className="mx-[18px] -mt-[0.5px] mb-4 grid grid-cols-4 gap-x-6 gap-y-3 border-t border-rule pt-3 @max-[560px]:grid-cols-2">
        <Field label="Categoria">{category}</Field>
        <Field label="Prioridade">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={`${dot} ${PRIORITY_DOT[ticket.priority]}`} />
            {PRIORITY_LABEL[ticket.priority]}
          </span>
        </Field>
        <Field label="Aberto em">
          {formatDayTime(ticket.createdAt)}
        </Field>
        <Field label="Última atualização">
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <span className={ticket.overdue ? "text-warning-text" : undefined}>
              {formatTimeAgo(ticket.updatedAt, ticket.checkedAt)}
            </span>
            {ticket.status === "resolved" ? null : (
              <span className="text-13.5 font-normal text-ink-3">· {ticket.overdue ? "prazo vencido" : "no prazo"}</span>
            )}
          </span>
        </Field>
      </dl>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-12.5 whitespace-nowrap text-ink-3">{label}</dt>
      <dd className="text-14.5 font-medium whitespace-nowrap text-ink">{children}</dd>
    </div>
  );
}
