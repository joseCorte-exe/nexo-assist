import type { Category, Priority, TicketStatus } from "./domain";

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
