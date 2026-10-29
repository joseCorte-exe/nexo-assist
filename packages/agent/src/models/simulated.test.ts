import { dueAt, type KbArticle, summarizeTurn, type Ticket, type TicketDetail } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createMemory, createNexoAgent } from "../agent";
import { replyOf } from "../testing";
import type { TicketDesk } from "../tools";
import { simulatedModel } from "./simulated";

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

// Monday 10:00 in São Paulo.
const NOW = new Date("2026-10-26T13:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const down = { ok: false, error: { code: "unavailable", message: "down" } } as const;

function ticket(fields: Pick<Ticket, "id" | "title" | "status" | "priority">, openedDaysAgo: number, itAnsweredDaysAgo: number | null = null): Ticket {
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

const notebook = ticket({ id: "INC-20311", title: "Notebook lento após atualização do Windows", priority: "medium", status: "waiting_for_analyst" }, 6);
const sharepoint = ticket({ id: "INC-20298", title: "Acesso à pasta Financeiro no SharePoint", priority: "medium", status: "in_progress" }, 8, 1);
const monitor = ticket({ id: "REQ-10442", title: "Segundo monitor para home office", priority: "low", status: "approved" }, 13, 7);

const details: Record<string, TicketDetail> = {
  "INC-20311": { ...notebook, assigneeName: null, updates: [] },
  "INC-20298": {
    ...sharepoint,
    assigneeName: "Juliana Costa",
    updates: [{ author: "analyst", text: "Pedimos a liberação ao dono da pasta.", createdAt: sharepoint.updatedAt }],
  },
};

/**
 * The ticket-service of these tests: a help center that answers by the first word it recognizes in the question,
 * and Ana's open tickets.
 */
const helpCenter = (state: "up" | "down" = "up", open: Ticket[] = [notebook, sharepoint, monitor]): TicketDesk => ({
  searchArticles: async (query) => {
    if (state === "down") return down;
    if (/vpn|809/i.test(query)) return { ok: true, data: [vpn] };
    if (/rh/i.test(query)) return { ok: true, data: [hr] };
    return { ok: true, data: [] };
  },
  listEmployeeTickets: async () => (state === "down" ? down : { ok: true, data: open }),
  getTicket: async (id) => (state === "down" ? down : { ok: true, data: details[id] ?? null }),
});

async function reply(text: string, center = helpCenter()) {
  const agent = createNexoAgent({
    model: simulatedModel(),
    memory: createMemory({ url: ":memory:" }),
    ticketService: center,
    now: () => NOW,
  });
  const { text: answer, toolCalls } = await replyOf(agent, { conversationId: "conv-1", employeeId: "emp-ana", text });
  const parts = toolCalls.map(({ toolName, args }) => ({ type: `tool-${toolName}`, toolCallId: toolName, state: "input-available", input: args }));
  return { text: answer, toolCalls, decision: summarizeTurn(parts as Parameters<typeof summarizeTurn>[0]) };
}

describe("simulatedModel", () => {
  it("records the decision, searches the help center and answers with the article", async () => {
    const result = await reply("Minha VPN dá erro 809");
    expect(result.decision).toMatchObject({
      record: { action: "Buscar na central de ajuda" },
      toolsUsed: ["recordDecision", "searchArticles"],
    });
    expect(result.decision.record?.confidence).toBeGreaterThan(0.6);
    expect(result.text).toContain(vpn.content);
  });

  it("says when the help center has nothing about the case", async () => {
    const result = await reply("Meu mouse está piscando em roxo");
    expect(result.text).toContain("Não encontrei nada sobre isso na central de ajuda");
  });

  it("redirects a subject of HR to its channel", async () => {
    const result = await reply("Como faço para pedir férias?");
    expect(result.decision).toMatchObject({
      record: { action: "Indicar o canal de RH" },
      toolsUsed: ["recordDecision", "redirectOutOfScope"],
    });
    expect(result.text).toContain("rh@nexo.com.br");
  });

  it("explains when the help center did not answer", async () => {
    const result = await reply("Minha VPN dá erro 809", helpCenter("down"));
    expect(result.text).toContain("A central de ajuda não respondeu");
  });

  it("answers a greeting without searching", async () => {
    const result = await reply("Oi, bom dia!");
    expect(result.decision.toolsUsed).toEqual(["recordDecision"]);
    expect(result.text).toContain("Como posso ajudar");
  });

  it("lists the open tickets and asks which one, with the choice, when the number is not given", async () => {
    const result = await reply("Qual o status do meu chamado?");
    expect(result.decision).toMatchObject({
      record: { action: "Consultar os chamados do funcionário" },
      toolsUsed: ["recordDecision", "listMyTickets", "offerTicketChoice"],
    });
    // The question goes with the list, in the tool, as the instructions ask of the real model.
    expect(result.text).toBe("");
    expect(result.toolCalls.at(-1)?.args).toEqual({
      question: "Você tem 3 chamados abertos. Sobre qual deles quer saber?",
      ticketIds: ["INC-20311", "INC-20298", "REQ-10442"],
    });
  });

  it("looks the only open ticket up at once", async () => {
    const result = await reply("Como está meu chamado?", helpCenter("up", [notebook]));
    // The only one is the overdue INC-20311, so the offer comes with it.
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "listMyTickets", "getTicket", "offerReplies"]);
  });

  it("says when there is no open ticket", async () => {
    const result = await reply("Como estão meus chamados?", helpCenter("up", []));
    expect(result.text).toBe("Você não tem chamados abertos agora.");
  });

  it("looks the ticket up by its number and offers an analyst when it is overdue", async () => {
    const result = await reply("INC-20311 · Notebook lento após atualização do Windows");
    expect(result.decision).toMatchObject({
      record: { action: "Consultar o INC-20311 e calcular o prazo" },
      toolsUsed: ["recordDecision", "getTicket", "offerReplies"],
    });
    expect(result.text).toBe("");
    expect(result.toolCalls.at(-1)?.args).toEqual({
      question: "Está sem atualização há 6 dias, acima do prazo de 3 dias úteis para prioridade média. Quer que eu chame um analista?",
      options: ["Falar com um analista", "Adicionar informação", "Não, obrigado"],
    });
  });

  it("tells a ticket on time with what IT wrote last", async () => {
    const result = await reply("Como está o inc-20298?");
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "getTicket"]);
    expect(result.text).toBe(
      'O INC-20298 está em andamento, dentro do prazo. A última atualização da TI: "Pedimos a liberação ao dono da pasta."',
    );
  });

  it("says a number is not among the employee's tickets", async () => {
    const result = await reply("E o INC-20319?");
    expect(result.text).toBe("Não encontrei o INC-20319 entre os seus chamados. Confira o número ou me conte do que se trata.");
  });

  it("explains when the ticket service did not answer", async () => {
    const result = await reply("Qual o status do meu chamado?", helpCenter("down"));
    expect(result.text).toBe("O serviço de chamados não respondeu agora. Tente de novo em instantes.");
  });

  it("is frank that it cannot call an analyst through the chat yet", async () => {
    const result = await reply("Falar com um analista");
    expect(result.decision.toolsUsed).toEqual(["recordDecision"]);
    expect(result.text).toBe("Ainda não consigo chamar um analista por aqui. Se for urgente, ligue no ramal 4000.");
  });

  it("is frank that it cannot add to a ticket yet", async () => {
    const result = await reply("Adicionar informação");
    expect(result.text).toBe("Ainda não consigo acrescentar informações ao chamado por aqui. Se for urgente, ligue no ramal 4000.");
  });

  it("accepts a no thanks", async () => {
    const result = await reply("Não, obrigado");
    expect(result.text).toBe("Tudo bem. Se precisar de mais alguma coisa, é só escrever.");
  });
});
