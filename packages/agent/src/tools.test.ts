import { RequestContext } from "@mastra/core/request-context";
import { dueAt, type KbArticle, type Ticket, type TicketDetail, type TicketServiceResult } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createTools, type TicketDesk } from "./tools";

// Monday 10:00 in São Paulo.
const NOW = new Date("2026-10-26T13:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const vpn: KbArticle = {
  id: "kb-vpn-809",
  title: "VPN com erro 809",
  content: "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador.",
  category: "network_vpn",
};
const hr: KbArticle = {
  id: "kb-hr-channel",
  title: "Assuntos de RH",
  content: "Férias e holerite são tratados pelo RH: rh@nexo.com.br ou ramal 4100.",
  category: "other",
};
// Another "other" article that also talks about the RH: not the channel.
const hours: KbArticle = {
  id: "kb-service-desk-hours",
  title: "Horário do service desk",
  content: "De segunda a sexta, das 8h às 18h. Dúvidas de RH vão para o canal do RH.",
  category: "other",
};

const down = { ok: false, error: { code: "unavailable", message: "Ticket service is unavailable" } } as const;
const unexpected = async (): Promise<never> => {
  throw new Error("not used in this test");
};

function helpCenter(articles: KbArticle[] | "down"): TicketDesk & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    searchArticles: async (query) => {
      queries.push(query);
      return articles === "down" ? down : { ok: true, data: articles };
    },
    listEmployeeTickets: unexpected,
    getTicket: unexpected,
  };
}

const tools = (desk: TicketDesk) => createTools({ ticketService: desk, now: () => NOW });

// The tools run outside an agent here. Those of the tickets read the employee from the request context, which
// the route fills with the session; the others need no context.
const run = <I, O>(tool: { execute?: (input: I, context: never) => Promise<O> }, input: I) =>
  tool.execute!(input, {} as never);
const runAs = <I, O>(employeeId: string, tool: { execute?: (input: I, context: never) => Promise<O> }, input: I) =>
  tool.execute!(input, { requestContext: new RequestContext([["employeeId", employeeId]]) } as never);

describe("recordDecision", () => {
  it("only acknowledges: the route saves the decision at the end of the reply", async () => {
    const { recordDecision } = tools(helpCenter([]));
    const result = await run(recordDecision, {
      understanding: "Dúvida sobre a VPN",
      action: "Buscar na central de ajuda",
      confidence: 0.8,
      reason: "Pode haver um artigo.",
    });
    expect(result).toEqual({ recorded: true });
  });
});

describe("searchArticles", () => {
  it("returns the articles of the help center for the question", async () => {
    const center = helpCenter([vpn]);
    const { searchArticles } = tools(center);
    expect(await run(searchArticles, { query: "vpn erro 809" })).toEqual({ ok: true, articles: [vpn] });
    expect(center.queries).toEqual(["vpn erro 809"]);
  });

  it("says the help center did not answer instead of failing, so the agent can explain", async () => {
    const { searchArticles } = tools(helpCenter("down"));
    expect(await run(searchArticles, { query: "vpn" })).toEqual({
      ok: false,
      message: "A central de ajuda não respondeu.",
    });
  });
});

describe("redirectOutOfScope", () => {
  it("finds the channel of the subject in the help center", async () => {
    const center = helpCenter([hr]);
    const { redirectOutOfScope } = tools(center);
    expect(await run(redirectOutOfScope, { area: "hr" })).toEqual({
      ok: true,
      area: "hr",
      channel: { title: hr.title, content: hr.content },
    });
    expect(center.queries).toEqual(["rh"]);
  });

  it("searches each area by the word the channel article uses", async () => {
    const center = helpCenter([]);
    const { redirectOutOfScope } = tools(center);
    await run(redirectOutOfScope, { area: "finance" });
    await run(redirectOutOfScope, { area: "facilities" });
    expect(center.queries).toEqual(["financeiro", "facilities"]);
  });

  it("takes the channel article of the area, even when another article comes first", async () => {
    const { redirectOutOfScope } = tools(helpCenter([hours, hr]));
    expect(await run(redirectOutOfScope, { area: "hr" })).toMatchObject({ ok: true, channel: { title: hr.title } });
  });

  it("never takes another article as the channel", async () => {
    const { redirectOutOfScope } = tools(helpCenter([hours, vpn]));
    expect(await run(redirectOutOfScope, { area: "hr" })).toEqual({
      ok: false,
      area: "hr",
      message: "Não achei o canal na central de ajuda.",
    });
  });

  it("says the help center did not answer", async () => {
    const { redirectOutOfScope } = tools(helpCenter("down"));
    expect(await run(redirectOutOfScope, { area: "facilities" })).toEqual({
      ok: false,
      area: "facilities",
      message: "A central de ajuda não respondeu.",
    });
  });
});

// Ana's tickets as the ticket-service answers them, most recent first, with the deadline of RN-02.
function ticket(fields: Partial<Ticket> & Pick<Ticket, "id" | "title" | "status" | "priority">, openedDaysAgo: number, itAnsweredDaysAgo: number | null = null): Ticket {
  const createdAt = new Date(NOW.getTime() - openedDaysAgo * DAY);
  const lastItResponseAt = itAnsweredDaysAgo === null ? null : new Date(NOW.getTime() - itAnsweredDaysAgo * DAY);
  return {
    type: "INC",
    description: "Descrição.",
    category: "hardware",
    subcategory: null,
    affected: "only_me",
    openedBy: "emp-ana",
    assignedTo: null,
    createdAt: createdAt.toISOString(),
    updatedAt: (lastItResponseAt ?? createdAt).toISOString(),
    lastItResponseAt: lastItResponseAt?.toISOString() ?? null,
    dueAt: dueAt({ priority: fields.priority, createdAt, lastItResponseAt }).toISOString(),
    resolvedAt: null,
    ...fields,
  };
}

const notebook = ticket(
  {
    id: "INC-20311",
    title: "Notebook lento após atualização do Windows",
    description: "Lentidão geral desde a atualização do Windows.",
    subcategory: "Notebook",
    priority: "medium",
    status: "waiting_for_analyst",
  },
  6,
);
const sharepoint = ticket(
  { id: "INC-20298", title: "Acesso à pasta Financeiro no SharePoint", category: "access", priority: "medium", status: "in_progress", assignedTo: "analyst-juliana" },
  8,
  1,
);
const monitor = ticket(
  { id: "REQ-10442", type: "REQ", title: "Segundo monitor para home office", priority: "low", status: "approved", assignedTo: "analyst-juliana" },
  13,
  7,
);

type Calls = { list: Array<[string, unknown]>; get: Array<[string, string]> };

/** A ticket-service with Ana's tickets, recording who each call was made for. */
function ticketDesk({ state = "up", tickets = [notebook, sharepoint, monitor], details = {} as Record<string, TicketDetail> } = {}) {
  const calls: Calls = { list: [], get: [] };
  const desk: TicketDesk = {
    searchArticles: unexpected,
    listEmployeeTickets: async (employeeId, options) => {
      calls.list.push([employeeId, options]);
      if (state === "down") return down;
      return { ok: true, data: employeeId === "emp-ana" ? tickets : [] };
    },
    getTicket: async (id, employeeId): Promise<TicketServiceResult<TicketDetail | null>> => {
      calls.get.push([id, employeeId]);
      if (state === "down") return down;
      return { ok: true, data: employeeId === "emp-ana" ? (details[id] ?? null) : null };
    },
  };
  return { desk, calls };
}

describe("listMyTickets", () => {
  it("lists the open tickets of the employee of the session, with the overdue of RN-02", async () => {
    const { desk, calls } = ticketDesk();
    const result = await runAs("emp-ana", tools(desk).listMyTickets, { scope: "open" });
    expect(result).toEqual({
      ok: true,
      tickets: [
        { id: "INC-20311", title: notebook.title, status: "waiting_for_analyst", createdAt: notebook.createdAt, overdue: true },
        { id: "INC-20298", title: sharepoint.title, status: "in_progress", createdAt: sharepoint.createdAt, overdue: false },
        { id: "REQ-10442", title: monitor.title, status: "approved", createdAt: monitor.createdAt, overdue: false },
      ],
    });
    expect(calls.list).toEqual([["emp-ana", { status: "open" }]]);
  });

  it("asks for every ticket, resolved included, with scope all", async () => {
    const { desk, calls } = ticketDesk();
    await runAs("emp-ana", tools(desk).listMyTickets, { scope: "all" });
    expect(calls.list).toEqual([["emp-ana", {}]]);
  });

  it("says the service did not answer instead of failing", async () => {
    const { desk } = ticketDesk({ state: "down" });
    expect(await runAs("emp-ana", tools(desk).listMyTickets, { scope: "open" })).toEqual({
      ok: false,
      message: "O serviço de chamados não respondeu.",
    });
  });

  it("never runs without the employee of the session", async () => {
    const { desk, calls } = ticketDesk();
    const result = await run(tools(desk).listMyTickets, { scope: "open" });
    expect(result).toMatchObject({ error: true });
    expect(calls.list).toEqual([]);
  });
});

describe("getTicket", () => {
  const notebookDetail: TicketDetail = { ...notebook, assigneeName: null, updates: [] };
  const monitorDetail: TicketDetail = {
    ...monitor,
    assigneeName: "Juliana Costa",
    updates: [
      { author: "employee", text: "Pode ser um de 24 polegadas?", createdAt: new Date(NOW.getTime() - 10 * DAY).toISOString() },
      { author: "analyst", text: "Pedido aprovado pelo gestor. O monitor será enviado.", createdAt: monitor.updatedAt },
      { author: "employee", text: "Obrigada!", createdAt: new Date(NOW.getTime() - 6 * DAY).toISOString() },
    ],
  };

  it("builds the card of an overdue ticket with the numbers ready for the model", async () => {
    const { desk, calls } = ticketDesk({ details: { "INC-20311": notebookDetail } });
    expect(await runAs("emp-ana", tools(desk).getTicket, { ticketId: "INC-20311" })).toEqual({
      ok: true,
      ticket: {
        id: "INC-20311",
        type: "INC",
        title: notebook.title,
        description: notebook.description,
        category: "hardware",
        subcategory: "Notebook",
        priority: "medium",
        status: "waiting_for_analyst",
        assigneeName: null,
        createdAt: notebook.createdAt,
        updatedAt: notebook.updatedAt,
        dueAt: notebook.dueAt,
        overdue: true,
        daysSinceUpdate: 6,
        deadline: "3 dias úteis",
        lastItUpdate: null,
        checkedAt: NOW.toISOString(),
      },
    });
    expect(calls.get).toEqual([["INC-20311", "emp-ana"]]);
  });

  it("keeps what IT wrote last, not the employee's follow-ups", async () => {
    const { desk } = ticketDesk({ details: { "REQ-10442": monitorDetail } });
    const result = await runAs("emp-ana", tools(desk).getTicket, { ticketId: "REQ-10442" });
    expect(result).toMatchObject({
      ok: true,
      ticket: { overdue: false, assigneeName: "Juliana Costa", deadline: "5 dias úteis", daysSinceUpdate: 7, lastItUpdate: "Pedido aprovado pelo gestor. O monitor será enviado." },
    });
  });

  it("asks for the ticket as the employee of the session, so another person's ticket is not found", async () => {
    const { desk, calls } = ticketDesk({ details: { "INC-20311": notebookDetail } });
    expect(await runAs("emp-carla", tools(desk).getTicket, { ticketId: "INC-20311" })).toEqual({
      ok: false,
      reason: "not_found",
      message: "Não encontrei o INC-20311 entre os seus chamados.",
    });
    expect(calls.get).toEqual([["INC-20311", "emp-carla"]]);
  });

  it("says the service did not answer", async () => {
    const { desk } = ticketDesk({ state: "down" });
    expect(await runAs("emp-ana", tools(desk).getTicket, { ticketId: "INC-20311" })).toEqual({
      ok: false,
      reason: "unavailable",
      message: "O serviço de chamados não respondeu.",
    });
  });
});

describe("offerTicketChoice", () => {
  it("shows the chosen tickets of the employee, in the order of the service", async () => {
    const { desk, calls } = ticketDesk();
    const result = await runAs("emp-ana", tools(desk).offerTicketChoice, { question: "Sobre qual deles quer saber?", ticketIds: ["REQ-10442", "INC-20311"] });
    expect(result).toEqual({
      ok: true,
      tickets: [
        { id: "INC-20311", title: notebook.title, status: "waiting_for_analyst", createdAt: notebook.createdAt, overdue: true },
        { id: "REQ-10442", title: monitor.title, status: "approved", createdAt: monitor.createdAt, overdue: false },
      ],
    });
    // Every ticket: the model may offer a resolved one too.
    expect(calls.list).toEqual([["emp-ana", undefined]]);
  });

  it("drops a number that is not the employee's, so the model can never show it", async () => {
    const { desk } = ticketDesk();
    const result = await runAs("emp-ana", tools(desk).offerTicketChoice, { question: "Sobre qual deles quer saber?", ticketIds: ["INC-20311", "INC-20319"] });
    expect(result).toMatchObject({ ok: true, tickets: [{ id: "INC-20311" }] });
  });

  it("has nothing to show when none of the numbers is the employee's", async () => {
    const { desk } = ticketDesk();
    expect(await runAs("emp-carla", tools(desk).offerTicketChoice, { question: "Sobre qual deles quer saber?", ticketIds: ["INC-20311", "REQ-10442"] })).toEqual({
      ok: false,
      message: "Nenhum desses chamados é seu.",
    });
  });

  it("says the service did not answer", async () => {
    const { desk } = ticketDesk({ state: "down" });
    expect(await runAs("emp-ana", tools(desk).offerTicketChoice, { question: "Sobre qual deles quer saber?", ticketIds: ["INC-20311", "REQ-10442"] })).toEqual({
      ok: false,
      message: "O serviço de chamados não respondeu.",
    });
  });
});

describe("offerReplies", () => {
  it("only shows the replies, which the screen draws from its input", async () => {
    const { desk } = ticketDesk();
    expect(await run(tools(desk).offerReplies, { question: "Quer ajuda?", options: ["Falar com um analista", "Não, obrigado"] })).toEqual({ shown: true });
  });
});
