import { TICKET_STATUS_LABEL, type TicketSummary } from "@nexo/shared";
import { WholePixel } from "@/components/whole-pixel";
import { formatDay } from "@/lib/format";
import { STATUS_DOT } from "@/lib/ticket-look";
import { type OfferMode, ticketChoiceText } from "@/lib/chat-turns";

type Props = {
  tickets: TicketSummary[];
  chosen: string | null;
  mode: OfferMode;
  onChoose: (text: string) => void;
};

/**
 * The "Ticket Selector" of nexo.pen: the employee's tickets to pick one. A click sends "INC-20311 · title" at once, so
 * the rows are buttons, never radios (an arrow key would send). The radio dot only draws the choice. Under 560 px
 * of column the title goes to its own line, whole.
 */
export function TicketChoice({ tickets, chosen, mode, onChoose }: Props) {
  return (
    <ul
      aria-label="Seus chamados"
      className="@container mt-1.5 w-full overflow-hidden rounded-2xl bg-white shadow-card outline-1 -outline-offset-[0.5px] outline-card-line"
    >
      {tickets.map((ticket) => {
        const isChosen = ticket.id === chosen;
        const row = <Row ticket={ticket} chosen={isChosen} />;
        return (
          // The divider straddles the edge between two rows, as nexo.pen draws it, so every row stays 46 px.
          <li
            key={ticket.id}
            className="relative [&+&]:before:absolute [&+&]:before:inset-x-0 [&+&]:before:-top-[0.5px] [&+&]:before:h-px [&+&]:before:bg-rule"
          >
            {mode === "answered" ? (
              <div className={`${rowClass} ${isChosen ? "bg-cta-soft" : ""}`}>
                {row}
                {isChosen ? <span className="sr-only">, sua escolha</span> : null}
              </div>
            ) : (
              <button
                type="button"
                aria-disabled={mode === "busy" || undefined}
                onClick={() => mode === "open" && onChoose(ticketChoiceText(ticket))}
                className={`${rowClass} group w-full text-left transition-colors duration-150 ease-out aria-disabled:cursor-progress focus-visible:-outline-offset-2 ${
                  mode === "open" ? "hover:bg-desk active:bg-cta-soft" : ""
                }`}
              >
                {row}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const rowClass =
  "flex min-h-[46px] items-center gap-3.5 px-4 py-3.5 @max-[560px]:grid @max-[560px]:grid-cols-[16px_1fr_auto] @max-[560px]:items-start @max-[560px]:gap-x-3 @max-[560px]:gap-y-1";

function Row({ ticket, chosen }: { ticket: TicketSummary; chosen: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={`size-4 shrink-0 rounded-full bg-white transition-[border-width,border-color] duration-150 ease-out @max-[560px]:row-span-2 @max-[560px]:mt-px ${
          chosen
            ? "border-[5px] border-cta"
            : "border-[1.5px] border-radio group-hover:border-ink-3 group-active:border-[5px] group-active:border-cta"
        }`}
      />
      <span className="text-12.5 font-medium whitespace-nowrap text-ink-3">
        {ticket.id}
        <span className="hidden @max-[560px]:inline font-normal"> · {formatDay(ticket.createdAt)}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-14.5 font-medium text-ink @max-[560px]:col-span-2 @max-[560px]:col-start-2 @max-[560px]:row-start-2 @max-[560px]:whitespace-normal">
        {ticket.title}
      </span>
      <WholePixel text={ticket.status} className="flex items-center gap-1.5 justify-self-end">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT[ticket.status]}`} />
        <span className="text-12.5 whitespace-nowrap text-ink-3">{TICKET_STATUS_LABEL[ticket.status]}</span>
      </WholePixel>
      <span className="w-11 shrink-0 text-right text-12.5 text-ink-3 @max-[560px]:hidden">
        {formatDay(ticket.createdAt)}
      </span>
    </>
  );
}
