import {
  type Affected,
  type Category,
  dueAt,
  isReopenable,
  type Priority,
  slaText,
  type TicketDetail,
  type TicketServiceResult,
  type TicketStatus,
  type TicketType,
} from "@nexo/shared";
// The ranking the help center runs, not a stand-in: what the model finds decides what it answers.
import { rankArticles, type SearchableArticle } from "../../../../apps/ticket-service/src/kb-search";
import type { DraftRecord, DraftStore, TicketDesk, TransferRecord, TransferStore } from "../tools";

// What each eval case runs against: the sample data of the ticket-service (apps/ticket-service/src/seed.ts) at a fixed
// moment, in memory, recording what the tools did. The agent and its tools are the real ones.

/** Monday 10:05 in São Paulo, in business hours: the clock of every case. */
export const NOW = new Date("2026-10-26T13:05:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type SampleTicket = {
  id: string;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  affected: Affected;
  status: TicketStatus;
  openedBy: string;
  assignedTo: string | null;
  openedAgo: number;
  itAnsweredAgo: number | null;
  resolvedAgo: number | null;
  /** What IT wrote last, if it did. */
  lastUpdate?: string;
};

const sampleTickets: SampleTicket[] = [
  {
    id: "INC-20311",
    type: "INC",
    title: "Notebook lento após atualização do Windows",
    description: "Lentidão geral desde a atualização do Windows. Reiniciar e rodar o diagnóstico da central não resolveu.",
    category: "hardware",
    subcategory: "Notebook",
    priority: "medium",
    affected: "only_me",
    status: "waiting_for_analyst",
    openedBy: "emp-ana",
    assignedTo: null,
    openedAgo: 6 * DAY,
    itAnsweredAgo: null,
    resolvedAgo: null,
  },
  {
    id: "REQ-10442",
    type: "REQ",
    title: "Segundo monitor para home office",
    description: "Preciso de um segundo monitor para trabalhar de casa.",
    category: "hardware",
    subcategory: null,
    priority: "low",
    affected: "only_me",
    status: "approved",
    openedBy: "emp-ana",
    assignedTo: "analyst-juliana",
    openedAgo: 13 * DAY,
    itAnsweredAgo: 7 * DAY,
    resolvedAgo: null,
    lastUpdate: "Pedido aprovado pelo gestor. O monitor será enviado.",
  },
  {
    id: "INC-20150",
    type: "INC",
    title: "Senha do SAP bloqueada",
    description: "Errei a senha do SAP algumas vezes e o acesso foi bloqueado.",
    category: "access",
    subcategory: "SAP",
    priority: "medium",
    affected: "only_me",
    status: "resolved",
    openedBy: "emp-ana",
    assignedTo: "analyst-juliana",
    openedAgo: 5 * DAY,
    itAnsweredAgo: 4 * DAY,
    resolvedAgo: 4 * DAY,
    lastUpdate: "Senha desbloqueada. Use a senha temporária enviada por e-mail.",
  },
  {
    id: "INC-20298",
    type: "INC",
    title: "Acesso à pasta Financeiro no SharePoint",
    description: "Não consigo abrir a pasta Financeiro no SharePoint, aparece acesso negado.",
    category: "access",
    subcategory: "SharePoint",
    priority: "medium",
    affected: "only_me",
    status: "in_progress",
    openedBy: "emp-ana",
    assignedTo: "analyst-juliana",
    openedAgo: 8 * DAY,
    itAnsweredAgo: 1 * DAY,
    resolvedAgo: null,
    lastUpdate: "Pedimos a liberação ao dono da pasta e aguardamos a resposta.",
  },
  {
    id: "INC-19877",
    type: "INC",
    title: "Outlook não sincroniza no celular",
    description: "Os e-mails pararam de chegar no aplicativo do Outlook no celular.",
    category: "email",
    subcategory: "Outlook",
    priority: "low",
    affected: "only_me",
    status: "resolved",
    openedBy: "emp-ana",
    assignedTo: "analyst-juliana",
    openedAgo: 15 * DAY,
    itAnsweredAgo: 12 * DAY,
    resolvedAgo: 12 * DAY,
  },
  {
    id: "INC-19410",
    type: "INC",
    title: "Impressora do 3º andar não imprime",
    description: "A impressora do 3º andar mostra erro e não imprime nada.",
    category: "hardware",
    subcategory: "Impressora",
    priority: "medium",
    affected: "my_team",
    status: "resolved",
    openedBy: "emp-ana",
    assignedTo: "analyst-marcos",
    openedAgo: 32 * DAY,
    itAnsweredAgo: 30 * DAY,
    resolvedAgo: 30 * DAY,
  },
  {
    id: "INC-20319",
    type: "INC",
    title: "Sistema de pedidos fora do ar para a equipe",
    description: "Ninguém da equipe de operações consegue entrar no sistema de pedidos.",
    category: "software",
    subcategory: "Sistema de pedidos",
    priority: "critical",
    affected: "my_team",
    status: "waiting_for_analyst",
    openedBy: "emp-diego",
    assignedTo: null,
    openedAgo: 35 * 60 * 1000,
    itAnsweredAgo: null,
    resolvedAgo: null,
  },
  {
    id: "INC-20302",
    type: "INC",
    title: "VPN com erro 809",
    description: "A VPN mostra erro 809 ao conectar de casa.",
    category: "network_vpn",
    subcategory: "VPN",
    priority: "high",
    affected: "only_me",
    status: "assigned",
    openedBy: "emp-fabio",
    assignedTo: "analyst-rafael",
    openedAgo: 3 * HOUR,
    itAnsweredAgo: 1 * HOUR,
    resolvedAgo: null,
    lastUpdate: "Estou verificando o cliente de VPN da sua máquina.",
  },
  {
    id: "REQ-10450",
    type: "REQ",
    title: "Licença do Power BI",
    description: "Preciso de uma licença do Power BI para os relatórios de vendas.",
    category: "software",
    subcategory: "Power BI",
    priority: "low",
    affected: "only_me",
    status: "waiting_for_analyst",
    openedBy: "emp-bruno",
    assignedTo: null,
    openedAgo: 1 * DAY,
    itAnsweredAgo: null,
    resolvedAgo: null,
  },
  {
    id: "INC-20297",
    type: "INC",
    title: "Caixa de e-mail cheia",
    description: "O Outlook avisa que a caixa de e-mail está cheia e não recebo mensagens novas.",
    category: "email",
    subcategory: "Outlook",
    priority: "high",
    affected: "only_me",
    status: "resolved",
    openedBy: "emp-gabriela",
    assignedTo: "analyst-marcos",
    openedAgo: 3 * DAY,
    itAnsweredAgo: 2 * DAY,
    resolvedAgo: 2 * DAY,
  },
];

const sampleArticles: SearchableArticle[] = [
  {
    id: "kb-vpn-809",
    title: "VPN com erro 809",
    content:
      "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. Vale apenas para Windows 10; no Windows 11, abra um chamado.",
    category: "network_vpn",
    keywords: ["vpn", "809", "erro 809", "conexão", "windows 10"],
  },
  {
    id: "kb-service-desk-hours",
    title: "Horário do service desk",
    content: "De segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas.",
    category: "other",
    keywords: ["horário", "atendimento", "plantão", "service desk"],
  },
  {
    id: "kb-sharepoint-access",
    title: "Como pedir acesso a uma pasta do SharePoint",
    content:
      "Abra a pasta, clique em Solicitar acesso e escreva o motivo. O dono da pasta aprova o pedido. Se ninguém responder em 2 dias úteis, abra um chamado.",
    category: "access",
    keywords: ["sharepoint", "pasta", "acesso negado", "permissão"],
  },
  {
    id: "kb-outlook-full",
    title: "Caixa de e-mail cheia",
    content:
      "Esvazie a pasta Itens Excluídos e arquive mensagens antigas pelo menu Arquivo > Ferramentas > Limpar itens antigos.",
    category: "email",
    keywords: ["outlook", "caixa cheia", "e-mail", "espaço"],
  },
  {
    id: "kb-hr-channel",
    title: "Assuntos de RH",
    content: "Férias, folha de ponto, benefícios e holerite são tratados pelo RH: rh@nexo.com.br ou ramal 4100.",
    category: "other",
    keywords: ["rh", "férias", "ponto", "benefícios", "holerite"],
  },
  {
    id: "kb-finance-channel",
    title: "Assuntos financeiros",
    content: "Reembolso, adiantamento e notas fiscais são tratados pelo financeiro: financeiro@nexo.com.br ou ramal 4200.",
    category: "other",
    keywords: ["financeiro", "reembolso", "adiantamento", "nota fiscal"],
  },
  {
    id: "kb-facilities-channel",
    title: "Assuntos de facilities",
    content:
      "Limpeza, ar-condicionado, crachá e reserva de salas são tratados por facilities: facilities@nexo.com.br ou ramal 4300.",
    category: "other",
    keywords: ["facilities", "ar-condicionado", "crachá", "sala", "limpeza"],
  },
];

function toDetail({ openedAgo, itAnsweredAgo, resolvedAgo, lastUpdate, ...ticket }: SampleTicket): TicketDetail {
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  const createdAt = ago(openedAgo);
  const lastItResponseAt = itAnsweredAgo === null ? null : ago(itAnsweredAgo);
  return {
    ...ticket,
    createdAt: createdAt.toISOString(),
    updatedAt: (lastItResponseAt ?? createdAt).toISOString(),
    lastItResponseAt: lastItResponseAt?.toISOString() ?? null,
    dueAt: dueAt({ priority: ticket.priority, createdAt, lastItResponseAt, reopenedAt: null }).toISOString(),
    resolvedAt: resolvedAgo === null ? null : ago(resolvedAgo).toISOString(),
    assigneeName: null,
    updates: lastUpdate && lastItResponseAt ? [{ author: "analyst", text: lastUpdate, createdAt: lastItResponseAt.toISOString() }] : [],
  };
}

/** A case's own reading of a sample ticket: for now, how long ago it was resolved. */
export type TicketChange = { id: string; resolvedAgoDays: number };

/** A new world for each run of a case, so no run sees what another did. */
export function createWorld({ resolved = [] }: { resolved?: TicketChange[] } = {}) {
  const tickets = sampleTickets.map((sample) => {
    const change = resolved.find((one) => one.id === sample.id);
    if (!change) return toDetail(sample);
    const resolvedAgo = change.resolvedAgoDays * DAY;
    return toDetail({ ...sample, resolvedAgo, itAnsweredAgo: resolvedAgo, openedAgo: resolvedAgo + DAY });
  });

  /** Every employee the tools asked the service about. */
  const askedFor: string[] = [];
  const savedDrafts: DraftRecord[] = [];
  const transfers: TransferRecord[] = [];
  /** The mark each transfer left on its ticket. */
  const markedTickets: string[] = [];

  const ok = <T>(data: T): TicketServiceResult<T> => ({ ok: true, data });
  const ofEmployee = (employeeId: string) => {
    askedFor.push(employeeId);
    return tickets.filter((ticket) => ticket.openedBy === employeeId);
  };
  const withoutUpdates = ({ updates: _updates, assigneeName: _assigneeName, ...ticket }: TicketDetail) => ticket;

  const desk: TicketDesk = {
    searchArticles: async (query) => ok(rankArticles(query, sampleArticles)),
    listEmployeeTickets: async (employeeId) => ok(ofEmployee(employeeId).map(withoutUpdates)),
    // The same answer the service gives for a ticket of someone else and for one that does not exist.
    getTicket: async (id, employeeId) => ok(ofEmployee(employeeId).find((ticket) => ticket.id === id) ?? null),
    listCandidates: async (employeeId, category) =>
      ok(
        ofEmployee(employeeId)
          .filter((ticket) => ticket.category === category && (ticket.status !== "resolved" || isReopenable(ticket, NOW)))
          .map(withoutUpdates),
      ),
    transferTicket: async (ticketId) => {
      markedTickets.push(ticketId);
      const ticket = tickets.find((one) => one.id === ticketId);
      if (!ticket) throw new Error(`A transfer marked ${ticketId}, which the sample data does not have`);
      return ok(withoutUpdates(ticket));
    },
  };

  const drafts: DraftStore = {
    save: async (draft) => {
      savedDrafts.push(draft);
      const { conversationId: _conversationId, impact: _impact, urgency: _urgency, notDuplicateReason: _reason, ...shown } = draft;
      return {
        ...shown,
        id: `draft-${savedDrafts.length}`,
        number: 380 + savedDrafts.length,
        status: "pending",
        rejectedReason: null,
        deadline: slaText(draft.priority),
        dueAt: draft.dueAt.toISOString(),
        createdAt: draft.createdAt.toISOString(),
      };
    },
  };

  const transferStore: TransferStore = {
    // The conversation only moves while it is with the agent, as in the conversations database.
    transfer: async (record) => {
      if (transfers.length > 0) return { transferred: false };
      transfers.push(record);
      return { transferred: true, noteId: `note-${transfers.length}` };
    },
  };

  return { desk, drafts, transfers: transferStore, tickets, askedFor, savedDrafts, savedTransfers: transfers, markedTickets };
}

export type World = ReturnType<typeof createWorld>;
