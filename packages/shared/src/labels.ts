import type { Category, DraftOperation, DraftRejection, Priority, TicketStatus } from "./domain";
import { draftLabel } from "./drafts";

// In code the values are English; the screen and the simulated agent say them with the words of the design
// (ARQUITETURA.md, section 6).

export const CATEGORY_LABEL: Record<Category, string> = {
  access: "Acesso",
  network_vpn: "Rede e VPN",
  hardware: "Hardware",
  software: "Software",
  email: "E-mail",
  other: "Outros",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Média",
  low: "Baixa",
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  waiting_for_analyst: "Aguardando analista",
  assigned: "Em atendimento",
  in_progress: "Em andamento",
  approved: "Aprovado",
  resolved: "Resolvido",
};

/** The status with who took the ticket, when it is in service: "Em atendimento · Assumido por Rafael Lima". */
export function statusText(status: TicketStatus, assigneeName: string | null): string {
  const label = TICKET_STATUS_LABEL[status];
  return status === "assigned" && assigneeName ? `${label} · Assumido por ${assigneeName}` : label;
}

type DraftCopy = {
  /** On top of the card: "Novo chamado · Rascunho D-381", "Complemento · INC-20311". */
  kind: string;
  /** The label of the text the employee checks: what happens, or only what is new. */
  description: string;
  /** On Confirmar while the ticket-service answers. */
  working: string;
  /** The state once confirmed, and once refused. */
  done: string;
  notDone: string;
  /** What the confirmation did, on the card and for screen readers. */
  confirmed: (ticketId: string) => string;
  /** The draft in the words of a note: "o rascunho D-381", "o complemento do INC-20311". */
  named: (draft: { number: number; ticketId: string | null }) => string;
};

/** The words of each operation of a draft, for the card, the action line and the notes the chat leaves. */
export const DRAFT_COPY: Record<DraftOperation, DraftCopy> = {
  create: {
    kind: "Novo chamado",
    description: "Descrição",
    working: "Criando…",
    done: "Criado",
    notDone: "Não criado",
    confirmed: (id) => `Chamado ${id} criado.`,
    named: (draft) => `o rascunho ${draftLabel(draft.number)}`,
  },
  update: {
    kind: "Complemento",
    description: "Informação nova",
    working: "Enviando…",
    done: "Enviado",
    notDone: "Não enviado",
    confirmed: (id) => `Complemento enviado ao ${id}.`,
    named: (draft) => `o complemento do ${draft.ticketId}`,
  },
  reopen: {
    kind: "Reabertura",
    description: "O que aconteceu de novo",
    working: "Reabrindo…",
    done: "Reaberto",
    notDone: "Não reaberto",
    confirmed: (id) => `${id} reaberto.`,
    named: (draft) => `a reabertura do ${draft.ticketId}`,
  },
};

/** Why the ticket-service refused the confirmation: the ticket changed between the draft and the click. */
export const REJECTION_LABEL: Record<DraftRejection, (ticketId: string | null) => string> = {
  ticket_not_found: () => "Não encontrei esse chamado entre os seus.",
  ticket_resolved: (id) => `O ${id} foi resolvido e não recebe mais complementos.`,
  ticket_not_resolved: (id) => `O ${id} não está mais resolvido.`,
  reopen_window_closed: (id) => `O ${id} foi resolvido há mais de 7 dias e não pode mais ser reaberto.`,
};
