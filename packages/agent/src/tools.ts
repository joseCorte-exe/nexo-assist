import { createTool } from "@mastra/core/tools";
import {
  isOverdue,
  nexoToolSchemas,
  type OutOfScopeArea,
  slaText,
  type Ticket,
  type TicketCard,
  type TicketServiceClient,
  type TicketSummary,
} from "@nexo/shared";
import { z } from "zod";

/** The part of the ticket-service the tools use: the help center and the employee's tickets. */
export type TicketDesk = Pick<TicketServiceClient, "searchArticles" | "listEmployeeTickets" | "getTicket">;

const HELP_CENTER_DOWN = "A central de ajuda não respondeu.";
const TICKETS_DOWN = "O serviço de chamados não respondeu.";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The channel article of each area in the help center (they live in the sample data), and the word that finds it. */
const AREA_CHANNEL: Record<OutOfScopeArea, { query: string; articleId: string }> = {
  hr: { query: "rh", articleId: "kb-hr-channel" },
  finance: { query: "financeiro", articleId: "kb-finance-channel" },
  facilities: { query: "facilities", articleId: "kb-facilities-channel" },
};

/**
 * Whose tickets they are. The route puts the employee of the session in the request context, and Mastra checks it
 * against this schema before the tool runs: without it the tool does not run at all. The model has no say.
 */
const employeeContext = z.object({ employeeId: z.string().min(1) });
type EmployeeContext = z.infer<typeof employeeContext>;
const employeeOf = (context: { requestContext: { get: (key: "employeeId") => EmployeeContext["employeeId"] } }) =>
  context.requestContext.get("employeeId");

export function createTools({ ticketService, now }: { ticketService: TicketDesk; now: () => Date }) {
  const summarize = (ticket: Ticket, at: Date): TicketSummary => ({
    id: ticket.id,
    title: ticket.title,
    status: ticket.status,
    createdAt: ticket.createdAt,
    overdue: isOverdue({ status: ticket.status, dueAt: new Date(ticket.dueAt) }, at),
  });

  const recordDecision = createTool({
    id: "recordDecision",
    description:
      "Registra o que você entendeu, a ação que vai tomar, sua segurança (0 a 1) e o motivo. É sempre o primeiro passo da resposta.",
    ...nexoToolSchemas.recordDecision,
    // The route saves the decision when the reply ends, together with the tools that ran.
    execute: async () => ({ recorded: true as const }),
  });

  const searchArticles = createTool({
    id: "searchArticles",
    description: "Procura artigos na central de ajuda de TI da Nexo para responder a dúvida do funcionário.",
    ...nexoToolSchemas.searchArticles,
    execute: async ({ query }) => {
      const result = await ticketService.searchArticles(query);
      return result.ok ? { ok: true as const, articles: result.data } : { ok: false as const, message: HELP_CENTER_DOWN };
    },
  });

  const redirectOutOfScope = createTool({
    id: "redirectOutOfScope",
    description:
      "Para assuntos que não são de TI (RH, financeiro, facilities): busca o canal certo para indicar ao funcionário.",
    ...nexoToolSchemas.redirectOutOfScope,
    execute: async ({ area }) => {
      const { query, articleId } = AREA_CHANNEL[area];
      const result = await ticketService.searchArticles(query);
      if (!result.ok) return { ok: false as const, area, message: HELP_CENTER_DOWN };
      const channel = result.data.find((article) => article.id === articleId);
      return channel
        ? { ok: true as const, area, channel: { title: channel.title, content: channel.content } }
        : { ok: false as const, area, message: "Não achei o canal na central de ajuda." };
    },
  });

  const listMyTickets = createTool({
    id: "listMyTickets",
    description:
      "Lista os chamados do funcionário, do mais recente para o mais antigo, com o status e se está vencido. Use quando ele falar de um chamado sem dizer o número.",
    ...nexoToolSchemas.listMyTickets,
    requestContextSchema: employeeContext,
    execute: async ({ scope }, context) => {
      const result = await ticketService.listEmployeeTickets(
        employeeOf(context),
        scope === "open" ? { status: "open" } : {},
      );
      if (!result.ok) return { ok: false as const, message: TICKETS_DOWN };
      const at = now();
      return { ok: true as const, tickets: result.data.map((ticket) => summarize(ticket, at)) };
    },
  });

  const getTicket = createTool({
    id: "getTicket",
    description:
      "Consulta um chamado do funcionário pelo número: status, prioridade, prazo, se está vencido e o que a TI escreveu por último. O funcionário vê o card do chamado.",
    ...nexoToolSchemas.getTicket,
    requestContextSchema: employeeContext,
    execute: async ({ ticketId }, context) => {
      const result = await ticketService.getTicket(ticketId, employeeOf(context));
      if (!result.ok) return { ok: false as const, reason: "unavailable" as const, message: TICKETS_DOWN };
      if (!result.data) {
        return {
          ok: false as const,
          reason: "not_found" as const,
          message: `Não encontrei o ${ticketId} entre os seus chamados.`,
        };
      }
      const { updates, ...ticket } = result.data;
      const at = now();
      const card: TicketCard = {
        id: ticket.id,
        type: ticket.type,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        subcategory: ticket.subcategory,
        priority: ticket.priority,
        status: ticket.status,
        assigneeName: ticket.assigneeName,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        dueAt: ticket.dueAt,
        overdue: summarize(ticket, at).overdue,
        daysSinceUpdate: Math.max(0, Math.floor((at.getTime() - new Date(ticket.updatedAt).getTime()) / DAY_MS)),
        deadline: slaText(ticket.priority),
        lastItUpdate: updates.filter((update) => update.author !== "employee").at(-1)?.text ?? null,
        checkedAt: at.toISOString(),
      };
      return { ok: true as const, ticket: card };
    },
  });

  const offerTicketChoice = createTool({
    id: "offerTicketChoice",
    description:
      "Mostra ao funcionário a pergunta e uma lista dos chamados dele para ele escolher um. A pergunta vai em question, não no texto. Encerra a sua resposta.",
    ...nexoToolSchemas.offerTicketChoice,
    requestContextSchema: employeeContext,
    execute: async ({ ticketIds }, context) => {
      // The rows come from the service, never from the model: a number that is not the employee's is dropped.
      const result = await ticketService.listEmployeeTickets(employeeOf(context));
      if (!result.ok) return { ok: false as const, message: TICKETS_DOWN };
      const chosen = new Set(ticketIds);
      const at = now();
      const tickets = result.data.filter((ticket) => chosen.has(ticket.id)).map((ticket) => summarize(ticket, at));
      return tickets.length > 0
        ? { ok: true as const, tickets }
        : { ok: false as const, message: "Nenhum desses chamados é seu." };
    },
  });

  const offerReplies = createTool({
    id: "offerReplies",
    description:
      "Mostra a pergunta e de 2 a 4 respostas rápidas como botões, para o funcionário responder com um clique. A pergunta vai em question, não no texto. Encerra a sua resposta.",
    ...nexoToolSchemas.offerReplies,
    execute: async () => ({ shown: true as const }),
  });

  return { recordDecision, searchArticles, redirectOutOfScope, listMyTickets, getTicket, offerTicketChoice, offerReplies };
}

/** The tools that hand the turn to the employee: once one of them runs, the reply ends. */
export const OFFER_TOOLS = new Set(["offerTicketChoice", "offerReplies"]);
