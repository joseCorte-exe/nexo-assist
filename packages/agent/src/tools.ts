import { createTool } from "@mastra/core/tools";
import {
  type Affected,
  CATEGORY_LABEL,
  canReopen,
  type Category,
  type DraftOperation,
  type DraftTicketInput,
  type DraftTicketOutput,
  type DraftView,
  deadlineWords,
  dueAt,
  type Impact,
  isOverdue,
  nexoToolSchemas,
  type OutOfScopeArea,
  type Priority,
  priorityFor,
  slaText,
  type Ticket,
  type TicketCard,
  type TicketServiceClient,
  type TicketSummary,
  type TicketType,
  type Urgency,
} from "@nexo/shared";
import { z } from "zod";

/** The part of the ticket-service the tools use: the help center, the employee's tickets and the duplicate lookup. */
export type TicketDesk = Pick<TicketServiceClient, "searchArticles" | "listEmployeeTickets" | "getTicket" | "listCandidates">;

/** A draft as the tool hands it to be saved: what the card shows, plus what the console and the analyst need. */
export type DraftRecord = {
  conversationId: string;
  operation: DraftOperation;
  /** The ticket followed up or reopened; null for a new one. */
  ticketId: string | null;
  type: TicketType;
  title: string;
  description: string;
  category: Category;
  subcategory: string | null;
  priority: Priority;
  affected: Affected;
  /** What RN-01 read, for a new ticket. A follow-up and a reopening keep the priority of the ticket. */
  impact: Impact | null;
  urgency: Urgency | null;
  notDuplicateReason: string | null;
  dueAt: Date;
  createdAt: Date;
};

/** Where drafts are kept: the conversations database, which the web owns. Saving one replaces the pending one. */
export type DraftStore = { save: (draft: DraftRecord) => Promise<DraftView> };

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

/** A draft also needs the conversation it belongs to, which the route puts in the context too. */
const turnContext = employeeContext.extend({ conversationId: z.string().min(1) });
type TurnContext = z.infer<typeof turnContext>;

type DraftFailure = Extract<DraftTicketOutput, { ok: false }>;
const failure = (reason: DraftFailure["reason"], message: string): DraftFailure => ({ ok: false, reason, message });

export function createTools({ ticketService, drafts, now }: { ticketService: TicketDesk; drafts: DraftStore; now: () => Date }) {
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
      "Lista os chamados do funcionário, do mais recente para o mais antigo, com o status e se está vencido. Com scope open, traz à parte (recentlyResolved) os resolvidos há até 7 dias, que são reabertos se o problema voltou. Use quando ele falar de um chamado sem dizer o número, e antes de abrir um chamado.",
    ...nexoToolSchemas.listMyTickets,
    requestContextSchema: employeeContext,
    execute: async ({ scope }, context) => {
      // Every ticket in one call: the open ones and, apart, the ones that can still be reopened.
      const result = await ticketService.listEmployeeTickets(employeeOf(context), {});
      if (!result.ok) return { ok: false as const, message: TICKETS_DOWN };
      const at = now();
      const summaries = (tickets: Ticket[]) => tickets.map((ticket) => summarize(ticket, at));
      if (scope === "all") return { ok: true as const, tickets: summaries(result.data) };
      const open = result.data.filter((ticket) => ticket.status !== "resolved");
      const reopenable = result.data.filter(
        (ticket) => ticket.status === "resolved" && ticket.resolvedAt !== null && canReopen(new Date(ticket.resolvedAt), at),
      );
      return { ok: true as const, tickets: summaries(open), recentlyResolved: summaries(reopenable) };
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
    execute: async () => ({ ok: true as const }),
  });

  /**
   * A new ticket: type and priority from the impact (RN-01), and no draft over a ticket that may be the same: an open
   * one of the category, or one resolved up to 7 days ago, which is reopened instead.
   */
  async function draftNew(input: DraftTicketInput, { employeeId, conversationId }: TurnContext): Promise<DraftTicketOutput> {
    // The schema already made sure a create carries these.
    const { title, category, impact, urgency, affected } = input as Required<DraftTicketInput>;
    const candidates = await ticketService.listCandidates(employeeId, category);
    if (!candidates.ok) return failure("unavailable", TICKETS_DOWN);
    const at = now();
    if (candidates.data.length > 0 && !input.notDuplicateReason) {
      return {
        ...failure(
          "possible_duplicate",
          `O funcionário já tem chamados de ${CATEGORY_LABEL[category]} que podem ser o mesmo problema. Se for o mesmo de um aberto, monte um update dele; de um resolvido, um reopen. Se não for, chame de novo com notDuplicateReason.`,
        ),
        candidates: candidates.data.map((ticket) => summarize(ticket, at)),
      };
    }
    const priority = priorityFor({ impact, urgency, affected });
    const due = dueAt({ priority, createdAt: at, lastItResponseAt: null });
    const draft = await drafts.save({
      conversationId,
      operation: "create",
      ticketId: null,
      type: impact === "request" ? "REQ" : "INC",
      title,
      description: input.description,
      category,
      subcategory: input.subcategory ?? null,
      priority,
      affected,
      impact,
      urgency,
      notDuplicateReason: input.notDuplicateReason ?? null,
      dueAt: due,
      createdAt: at,
    });
    return { ok: true, draft, dueText: deadlineWords(due, at) };
  }

  /**
   * A follow-up of an open ticket, or the reopening of one resolved up to 7 days ago. Both keep the classification of
   * the ticket; only the reopening restarts the deadline, as a new opening. The service checks the same again when
   * the employee confirms.
   */
  async function draftChange(input: DraftTicketInput, { employeeId, conversationId }: TurnContext): Promise<DraftTicketOutput> {
    const ticketId = input.ticketId!;
    const result = await ticketService.getTicket(ticketId, employeeId);
    if (!result.ok) return failure("unavailable", TICKETS_DOWN);
    const ticket = result.data;
    if (!ticket) return failure("not_found", `Não encontrei o ${ticketId} entre os seus chamados.`);
    const at = now();
    const resolved = ticket.status === "resolved";

    let due: Date;
    if (input.operation === "update") {
      if (resolved) {
        return failure("resolved", `O ${ticket.id} está resolvido. Se o problema voltou, monte um reopen; ele vale até 7 dias depois da resolução.`);
      }
      due = new Date(ticket.dueAt);
    } else {
      if (!resolved || !ticket.resolvedAt) {
        return failure("not_resolved", `O ${ticket.id} não está resolvido. Para acrescentar uma informação, monte um update.`);
      }
      if (!canReopen(new Date(ticket.resolvedAt), at)) {
        return failure("reopen_window_closed", `O ${ticket.id} foi resolvido há mais de 7 dias e não pode ser reaberto. Monte um chamado novo (create).`);
      }
      due = dueAt({ priority: ticket.priority, createdAt: at, lastItResponseAt: null });
    }

    const draft = await drafts.save({
      conversationId,
      operation: input.operation,
      ticketId: ticket.id,
      type: ticket.type,
      title: ticket.title,
      description: input.description,
      category: ticket.category,
      subcategory: ticket.subcategory,
      priority: ticket.priority,
      affected: ticket.affected,
      impact: null,
      urgency: null,
      notDuplicateReason: null,
      dueAt: due,
      createdAt: at,
    });
    const overdue = input.operation === "update" && isOverdue({ status: ticket.status, dueAt: due }, at);
    return { ok: true, draft, dueText: overdue ? "prazo vencido" : deadlineWords(due, at) };
  }

  const draftTicket = createTool({
    id: "draftTicket",
    description:
      "Monta o rascunho de um chamado novo (create), do complemento de um chamado aberto (update) ou da reabertura de um chamado resolvido há até 7 dias (reopen). O funcionário vê o card e confere: nada é criado antes de ele clicar em Confirmar. O código calcula o tipo, a prioridade e o prazo e confere duplicidade e a janela de reabertura.",
    ...nexoToolSchemas.draftTicket,
    requestContextSchema: turnContext,
    execute: async (input, context) => {
      const turn = { employeeId: employeeOf(context), conversationId: context.requestContext.get("conversationId") };
      return input.operation === "create" ? draftNew(input, turn) : draftChange(input, turn);
    },
  });

  return {
    recordDecision,
    searchArticles,
    redirectOutOfScope,
    listMyTickets,
    getTicket,
    offerTicketChoice,
    offerReplies,
    draftTicket,
  };
}

/** The tools that hand the turn to the employee: once one of them runs, the reply ends. */
export const OFFER_TOOLS = new Set(["offerTicketChoice", "offerReplies"]);
