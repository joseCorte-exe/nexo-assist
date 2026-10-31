import { DRAFT_COPY, isRefusedInput, type NexoUIMessage } from "@nexo/shared";

type Part = NexoUIMessage["parts"][number];
type StepState = "running" | "done" | "failed";

/** An item of the action line above a reply ("✓ consultou seus chamados"). */
export type Step = { key: string; label: string; state: StepState };

/**
 * The words of the action line, by tool, in each state. Tools without a label here (recordDecision, the offers, the
 * memory tool) are not actions the employee needs to see: an offer is a question to her, not something the agent did.
 */
const LABELS = {
  searchArticles: {
    running: "buscando na central de ajuda",
    done: "buscou na central de ajuda",
    failed: "não acessou a central de ajuda",
  },
  redirectOutOfScope: {
    running: "procurando o canal certo",
    done: "indicou o canal certo",
    failed: "não encontrou o canal",
  },
  listMyTickets: {
    running: "consultando seus chamados",
    done: "consultou seus chamados",
    failed: "não acessou seus chamados",
  },
} as const;

/** Shown while the agent records its decision, before any tool runs. */
export const THINKING_LABEL = "entendendo o pedido";

const stateOf = (part: { state: string; output?: unknown }, ok: boolean): StepState =>
  part.state === "output-error" || (part.state === "output-available" && !ok)
    ? "failed"
    : part.state === "output-available"
      ? "done"
      : "running";

/** The items a part adds to the action line: none, one, or two for a ticket (the lookup and its deadline). */
export function stepsOf(part: Part): Step[] {
  switch (part.type) {
    case "tool-searchArticles":
    case "tool-redirectOutOfScope":
    case "tool-listMyTickets": {
      const tool = part.type.slice("tool-".length) as keyof typeof LABELS;
      const state = stateOf(part, part.state !== "output-available" || part.output.ok);
      return [{ key: part.toolCallId, label: LABELS[tool][state], state }];
    }
    case "tool-getTicket": {
      // The number is only certain once the input is complete.
      const ticketId = part.state === "input-streaming" ? undefined : part.input?.ticketId;
      const ticket = ticketId ? `o ${ticketId}` : "o chamado";
      if (part.state !== "output-available") {
        const state = stateOf(part, true);
        return [{ key: part.toolCallId, label: state === "failed" ? `não acessou ${ticket}` : `consultando ${ticket}`, state }];
      }
      if (!part.output.ok) {
        const verb = part.output.reason === "not_found" ? "não encontrou" : "não acessou";
        return [{ key: part.toolCallId, label: `${verb} ${ticket}`, state: "failed" }];
      }
      return [
        { key: part.toolCallId, label: `consultou ${ticket}`, state: "done" },
        { key: `${part.toolCallId}-deadline`, label: "calculou o prazo", state: "done" },
      ];
    }
    case "tool-draftTicket":
      return draftSteps(part);
    default:
      return [];
  }
}

type DraftPart = Extract<Part, { type: "tool-draftTicket" }>;

/**
 * The draft as the design names it: a new ticket is classified, its deadline looked up and the draft made. A
 * possible duplicate is something the agent found, not a failure.
 */
function draftSteps(part: DraftPart): Step[] {
  const key = part.toolCallId;
  if (part.state === "output-error" || (part.state === "output-available" && isRefusedInput(part.output))) return [];
  if (part.state !== "output-available") return [{ key, label: "montando o rascunho", state: "running" }];
  const { output } = part;
  if (!output.ok) {
    return output.reason === "possible_duplicate"
      ? [{ key, label: "encontrou um chamado parecido", state: "done" }]
      : [{ key, label: "não montou o rascunho", state: "failed" }];
  }
  const { draft } = output;
  const drafted: Step = { key, label: `montou ${DRAFT_COPY[draft.operation].named(draft)}`, state: "done" };
  if (draft.operation === "update") return [drafted];
  if (draft.operation === "reopen") return [{ key: `${key}-window`, label: "conferiu o prazo de 7 dias", state: "done" }, drafted];
  return [
    { key: `${key}-priority`, label: "classificou a prioridade", state: "done" },
    { key: `${key}-sla`, label: "consultou o SLA", state: "done" },
    { key, label: "montou o rascunho", state: "done" },
  ];
}
