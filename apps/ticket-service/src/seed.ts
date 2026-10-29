import {
  type Affected,
  type Category,
  dueAt,
  type Priority,
  sampleAnalysts,
  sampleEmployees,
  type TicketStatus,
  type TicketType,
} from "@nexo/shared";
import type { Db } from "./db";
import { analysts, employees, idempotencyKeys, kbArticles, serviceState, tickets, ticketUpdates } from "./db/schema";

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
  /** How long ago it was opened. */
  openedAgo: number;
  /** How long ago IT last answered, if it did. */
  itAnsweredAgo: number | null;
  resolvedAgo: number | null;
};

// Annex B tickets keep their exact data. The rest come from the design or fill the situations it asks for.
// TODO(design): titles of INC-19877, INC-19410 and the other employees' tickets are placeholders until checked against nexo.pen.
const sampleTickets: SampleTicket[] = [
  {
    id: "INC-20311",
    type: "INC",
    title: "Notebook lento após atualização do Windows",
    // The description of the design, without its fixed date.
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
    // Opened 7 days before INC-20311, as the dates of the design (16 out and 09 out) are apart.
    openedAgo: 13 * DAY,
    itAnsweredAgo: 7 * DAY,
    resolvedAgo: null,
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
  },
  {
    // INC-20298 is the number the design shows in the chat and in the console.
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
    // Two days before INC-20311, as in the design (14 out and 16 out).
    openedAgo: 8 * DAY,
    itAnsweredAgo: 1 * DAY,
    resolvedAgo: null,
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

const sampleUpdates = [
  { ticketId: "REQ-10442", author: "analyst", text: "Pedido aprovado pelo gestor. O monitor será enviado.", ago: 7 * DAY },
  { ticketId: "INC-20150", author: "analyst", text: "Senha desbloqueada. Use a senha temporária enviada por e-mail.", ago: 4 * DAY },
  { ticketId: "INC-20298", author: "analyst", text: "Pedimos a liberação ao dono da pasta e aguardamos a resposta.", ago: 1 * DAY },
  { ticketId: "INC-20302", author: "analyst", text: "Estou verificando o cliente de VPN da sua máquina.", ago: 1 * HOUR },
] as const;

const sampleArticles = [
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
] as const satisfies ReadonlyArray<{ category: Category } & Record<string, unknown>>;

/** Recreates the sample data with dates relative to `now`. */
export async function seed(db: Db, now: Date = new Date()) {
  const ago = (ms: number) => new Date(now.getTime() - ms);

  await db.transaction(async (tx) => {
    await tx.delete(ticketUpdates);
    await tx.delete(tickets);
    await tx.delete(idempotencyKeys);
    await tx.delete(kbArticles);
    await tx.delete(employees);
    await tx.delete(analysts);
    await tx.delete(serviceState);

    // 42 days, as the profile screen of the design shows.
    await tx.insert(employees).values(sampleEmployees.map((employee) => ({ ...employee, passwordChangedAt: ago(42 * DAY) })));
    await tx.insert(analysts).values([...sampleAnalysts]);
    await tx.insert(kbArticles).values(sampleArticles.map((article) => ({ ...article, keywords: [...article.keywords] })));

    await tx.insert(tickets).values(
      sampleTickets.map(({ openedAgo, itAnsweredAgo, resolvedAgo, ...ticket }) => {
        const createdAt = ago(openedAgo);
        const lastItResponseAt = itAnsweredAgo === null ? null : ago(itAnsweredAgo);
        return {
          ...ticket,
          createdAt,
          updatedAt: lastItResponseAt ?? createdAt,
          lastItResponseAt,
          dueAt: dueAt({ priority: ticket.priority, createdAt, lastItResponseAt }),
          resolvedAt: resolvedAgo === null ? null : ago(resolvedAgo),
        };
      }),
    );

    await tx.insert(ticketUpdates).values(
      sampleUpdates.map((update, index) => ({
        id: `upd-${index + 1}`,
        ticketId: update.ticketId,
        author: update.author,
        text: update.text,
        createdAt: ago(update.ago),
      })),
    );

    await tx.insert(serviceState).values({ id: 1, unavailableUntil: null });
  });
}
