import { dueAt, type KbArticle, slaText, summarizeTurn, type Ticket, type TicketDetail } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createMemory, createNexoAgent } from "../agent";
import { replyOf } from "../testing";
import type { DraftRecord, DraftStore, TicketDesk } from "../tools";
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

function ticket(
  fields: Pick<Ticket, "id" | "title" | "status" | "priority"> & Partial<Ticket>,
  openedDaysAgo: number,
  itAnsweredDaysAgo: number | null = null,
): Ticket {
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
const sharepoint = ticket({ id: "INC-20298", title: "Acesso à pasta Financeiro no SharePoint", category: "access", priority: "medium", status: "in_progress" }, 8, 1);
const monitor = ticket({ id: "REQ-10442", title: "Segundo monitor para home office", priority: "low", status: "approved" }, 13, 7);

const sap = ticket(
  { id: "INC-20150", title: "Senha do SAP bloqueada", category: "access", priority: "medium", status: "resolved", resolvedAt: new Date(NOW.getTime() - 4 * DAY).toISOString() },
  5,
  4,
);
const outlook = ticket(
  { id: "INC-19877", title: "Outlook não sincroniza no celular", category: "email", priority: "low", status: "resolved", resolvedAt: new Date(NOW.getTime() - 12 * DAY).toISOString() },
  15,
  12,
);

const details: Record<string, TicketDetail> = {
  "INC-20150": { ...sap, assigneeName: null, updates: [] },
  "INC-19877": { ...outlook, assigneeName: null, updates: [] },
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
const helpCenter = (state: "up" | "down" = "up", open: Ticket[] = [notebook, sharepoint, monitor], candidates?: Ticket[]): TicketDesk => ({
  searchArticles: async (query) => {
    if (state === "down") return down;
    if (/vpn|809/i.test(query)) return { ok: true, data: [vpn] };
    if (/rh/i.test(query)) return { ok: true, data: [hr] };
    return { ok: true, data: [] };
  },
  listEmployeeTickets: async (_employeeId, options) =>
    state === "down" ? down : { ok: true, data: options?.status === "open" ? open : [...open, sap, outlook] },
  getTicket: async (id) => (state === "down" ? down : { ok: true, data: details[id] ?? null }),
  listCandidates: async (_employeeId, category) =>
    state === "down" ? down : { ok: true, data: (candidates ?? open).filter((one) => one.category === category) },
});

/** Every draft the agent saved, as the web would keep it. */
const savedDrafts: DraftRecord[] = [];
const drafts: DraftStore = {
  save: async (draft) => {
    savedDrafts.push(draft);
    const { conversationId, impact, urgency, notDuplicateReason, ...shown } = draft;
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

const newAgent = (center: TicketDesk) =>
  createNexoAgent({ model: simulatedModel(), memory: createMemory({ url: ":memory:" }), ticketService: center, drafts, now: () => NOW });

async function reply(text: string, center = helpCenter(), agent = newAgent(center)) {
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

  it("reads a ticket chosen from the list by its number, even when its title has words of another area", async () => {
    // "Financeiro" is in the title, not a question about the finance team.
    const result = await reply("INC-20298 · Acesso à pasta Financeiro no SharePoint");
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "getTicket"]);
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


  it("accepts a no thanks", async () => {
    const result = await reply("Não, obrigado");
    expect(result.text).toBe("Tudo bem. Se precisar de mais alguma coisa, é só escrever.");
  });
});

/** One conversation of several turns, with the same memory, as the chat runs it. */
function conversation(center = helpCenter()) {
  const agent = newAgent(center);
  return (text: string) => reply(text, center, agent);
}

const AFFECTED = ["Só eu", "Minha equipe", "Toda a empresa", "Não sei"];
const argsOf = (result: Awaited<ReturnType<typeof reply>>, toolName: string) =>
  result.toolCalls.filter((call) => call.toolName === toolName).map((call) => call.args);

describe("simulatedModel opening and following up tickets (feature 4)", () => {
  it("takes a problem to a ticket: looks for open tickets and the help center, then asks who is affected", async () => {
    const result = await reply("Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
    expect(result.decision).toMatchObject({
      record: { action: "Conferir os chamados abertos e a central de ajuda antes de abrir um chamado" },
      toolsUsed: ["recordDecision", "listMyTickets", "searchArticles", "offerReplies"],
    });
    expect(result.text).toBe(
      'Não há chamado aberto sobre isso, e o artigo "VPN com erro 809" da central de ajuda não resolveu. Vou abrir um chamado.',
    );
    expect(argsOf(result, "offerReplies")).toEqual([{ question: "Quem está sendo afetado?", options: AFFECTED }]);
  });

  it("drafts the ticket from the problem and the answer, with what RN-01 needs, and says the priority above the card", async () => {
    savedDrafts.length = 0;
    const say = conversation();
    await say("Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
    const result = await say("Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.");
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "draftTicket"]);
    expect(argsOf(result, "draftTicket")).toEqual([
      {
        operation: "create",
        title: "Notebook não conecta na VPN desde ontem",
        description:
          "Meu notebook não conecta na VPN desde ontem. Aparece o erro 809. Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.",
        category: "network_vpn",
        subcategory: "VPN",
        impact: "stopped",
        urgency: "same_day",
        affected: "only_me",
      },
    ]);
    expect(savedDrafts.at(-1)?.priority).toBe("high");
    expect(result.text).toBe("Coloquei prioridade alta por causa do compromisso de hoje: a resposta chega hoje, até 14:00. Confira antes de eu criar:");
  });

  it("follows up the open ticket about the same problem instead of opening another", async () => {
    const say = conversation();
    await say("Meu notebook continua muito lento desde a atualização.");
    const result = await say("Só eu");
    expect(argsOf(result, "draftTicket").map((args) => (args as { operation: string }).operation)).toEqual(["create", "update"]);
    expect(argsOf(result, "draftTicket")[1]).toEqual({
      operation: "update",
      ticketId: "INC-20311",
      description: "Meu notebook continua muito lento desde a atualização.",
    });
    expect(result.text).toBe("Já existe o INC-20311 sobre isso, então vou acrescentar a informação a ele. Confira antes de eu enviar:");
  });

  it("opens another ticket when the open one of the category is another problem, saying why", async () => {
    const say = conversation();
    await say("O teclado do notebook não funciona desde cedo.");
    const result = await say("Só eu");
    const [first, second] = argsOf(result, "draftTicket") as Array<Record<string, unknown>>;
    expect(first).toMatchObject({ operation: "create", category: "hardware" });
    expect(second).toMatchObject({
      operation: "create",
      notDuplicateReason: "Os chamados abertos de hardware tratam de outro problema: INC-20311, REQ-10442.",
    });
  });

  it("reopens the resolved ticket the draft found as the same problem, instead of opening another", async () => {
    const say = conversation(helpCenter("up", [notebook, sharepoint, monitor], [sharepoint, sap]));
    await say("Não consigo entrar no SAP, a senha está bloqueada.");
    const result = await say("Só eu");
    expect(argsOf(result, "draftTicket")).toEqual([
      expect.objectContaining({ operation: "create", category: "access" }),
      { operation: "reopen", ticketId: "INC-20150", description: "Não consigo entrar no SAP, a senha está bloqueada." },
    ]);
  });

  it("asks what to add when the employee picks Adicionar informação, then drafts the follow-up", async () => {
    const say = conversation();
    await say("INC-20311 · Notebook lento após atualização do Windows");
    const asked = await say("Adicionar informação");
    expect(asked.decision.toolsUsed).toEqual(["recordDecision"]);
    expect(asked.text).toBe("O que você quer acrescentar ao INC-20311?");
    const result = await say("Agora trava também ao abrir o Teams.");
    expect(argsOf(result, "draftTicket")).toEqual([
      { operation: "update", ticketId: "INC-20311", description: "Agora trava também ao abrir o Teams." },
    ]);
    expect(result.text).toBe("Confira o que vou acrescentar ao INC-20311 antes de eu enviar:");
  });

  it("reopens a ticket resolved in the last 7 days when the problem came back", async () => {
    const result = await reply("A senha do SAP bloqueou de novo.");
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "listMyTickets", "draftTicket"]);
    expect(argsOf(result, "listMyTickets")).toEqual([{ scope: "all" }]);
    expect(argsOf(result, "draftTicket")).toEqual([
      { operation: "reopen", ticketId: "INC-20150", description: "A senha do SAP bloqueou de novo." },
    ]);
    expect(result.text).toBe("O INC-20150 foi resolvido há pouco e ainda pode ser reaberto. Confira antes de eu reabrir:");
  });

  it("past the 7 days, says the ticket cannot be reopened and starts a new one", async () => {
    const result = await reply("O Outlook do celular parou de sincronizar de novo.");
    expect(argsOf(result, "draftTicket")).toEqual([
      { operation: "reopen", ticketId: "INC-19877", description: "O Outlook do celular parou de sincronizar de novo." },
    ]);
    expect(result.text).toBe("O INC-19877 foi resolvido há mais de 7 dias e não pode ser reaberto. Vou abrir um chamado novo.");
    expect(argsOf(result, "offerReplies")).toEqual([{ question: "Quem está sendo afetado?", options: AFFECTED }]);
  });

  it("explains that it could not check, instead of offering a ticket, when the services did not answer", async () => {
    const result = await reply("A impressora do 3º andar não imprime", helpCenter("down"));
    expect(result.text).toBe("A central de ajuda não respondeu agora. Tente de novo em instantes; se for urgente, ligue no ramal 4000.");
    expect(argsOf(result, "offerReplies")).toEqual([]);
  });

  it("takes a message that does not answer who is affected as a new subject", async () => {
    const say = conversation();
    await say("Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
    const result = await say("Qual o status do meu chamado?");
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "listMyTickets", "offerTicketChoice"]);
  });

  it("still answers a plain question from the help center, without opening anything", async () => {
    const result = await reply("Minha VPN dá erro 809");
    expect(result.decision.toolsUsed).toEqual(["recordDecision", "searchArticles"]);
  });
});
