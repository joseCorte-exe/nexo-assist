import type { DecisionRecord, KbArticle, Ticket } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createNexoAgent, createMemory } from "./agent";
import { promptText, replyOf, scriptedModel } from "./testing";
import type { TicketDesk } from "./tools";

const hours: KbArticle = {
  id: "kb-service-desk-hours",
  title: "Horário do service desk",
  content: "De segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas.",
  category: "other",
};
const notebook: Ticket = {
  id: "INC-20311",
  type: "INC",
  title: "Notebook lento após atualização do Windows",
  description: "Lentidão geral.",
  category: "hardware",
  subcategory: "Notebook",
  priority: "medium",
  affected: "only_me",
  status: "waiting_for_analyst",
  openedBy: "emp-ana",
  assignedTo: null,
  createdAt: "2026-10-20T13:00:00.000Z",
  updatedAt: "2026-10-20T13:00:00.000Z",
  lastItResponseAt: null,
  dueAt: "2026-10-23T13:00:00.000Z",
  resolvedAt: null,
};
const monitor: Ticket = { ...notebook, id: "REQ-10442", type: "REQ", title: "Segundo monitor para home office" };

/** Who each ticket lookup was made for. */
const lookups: string[] = [];
const ticketService: TicketDesk = {
  searchArticles: async () => ({ ok: true, data: [hours] }),
  listEmployeeTickets: async (employeeId) => {
    lookups.push(employeeId);
    return { ok: true, data: [notebook, monitor] };
  },
  getTicket: async (_id, employeeId) => {
    lookups.push(employeeId);
    return { ok: true, data: null };
  },
};

const decision: DecisionRecord = {
  understanding: "Quer saber o horário do service desk",
  action: "Responder pela central de ajuda",
  confidence: 0.93,
  reason: "Existe um artigo sobre o horário.",
};
const answer = "O service desk atende de segunda a sexta, das 8h às 18h.";

const hoursScript = () => [
  { toolCalls: [{ toolName: "recordDecision", input: decision }] },
  { toolCalls: [{ toolName: "searchArticles", input: { query: "horário do service desk" } }] },
  { text: answer },
];

function setup(steps: Parameters<typeof scriptedModel>[0]) {
  const model = scriptedModel(steps);
  const memory = createMemory({ url: ":memory:" });
  const agent = createNexoAgent({ model, memory, ticketService });
  return { model, memory, agent };
}

const turn = { conversationId: "conv-1", employeeId: "emp-ana", text: "Qual o horário do service desk?" };

describe("streamReply", () => {
  it("records the decision, searches and answers", async () => {
    const { agent } = setup(hoursScript());
    expect(await replyOf(agent, turn)).toEqual({
      text: answer,
      toolCalls: [
        { toolName: "recordDecision", args: decision },
        { toolName: "searchArticles", args: { query: "horário do service desk" } },
      ],
    });
  });

  it("forces recordDecision in the first step and lets the model choose afterwards", async () => {
    const { agent, model } = setup(hoursScript());
    await replyOf(agent, turn);
    expect(model.calls[0]?.toolChoice).toEqual({ type: "tool", toolName: "recordDecision" });
    expect(model.calls[1]?.toolChoice).toEqual({ type: "auto" });
  });

  it("gives the model the article the help center found", async () => {
    const { agent, model } = setup(hoursScript());
    await replyOf(agent, turn);
    expect(promptText(model.calls[2]!)).toContain("das 8h às 18h");
  });

  it("remembers the earlier turns of the same conversation", async () => {
    const model = scriptedModel([
      ...hoursScript(),
      { toolCalls: [{ toolName: "recordDecision", input: { ...decision, understanding: "Pergunta de seguimento" } }] },
      { text: "Sim, de segunda a sexta." },
    ]);
    const agent = createNexoAgent({ model, memory: createMemory({ url: ":memory:" }), ticketService });
    await replyOf(agent, turn);
    await replyOf(agent, { ...turn, text: "E no sábado?" });

    const secondTurn = promptText(model.calls[3]!);
    expect(secondTurn).toContain("Qual o horário do service desk?");
    expect(secondTurn).toContain(answer);
    expect(secondTurn).toContain("E no sábado?");
  });

  it("does not mix two conversations", async () => {
    const model = scriptedModel([
      ...hoursScript(),
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      { text: "Oi!" },
    ]);
    const agent = createNexoAgent({ model, memory: createMemory({ url: ":memory:" }), ticketService });
    await replyOf(agent, turn);
    await replyOf(agent, { conversationId: "conv-2", employeeId: "emp-bruno", text: "Oi" });
    expect(promptText(model.calls[3]!)).not.toContain("Qual o horário do service desk?");
  });

  it("stops after 5 steps even if the model keeps calling tools", async () => {
    const again = { toolCalls: [{ toolName: "searchArticles", input: { query: "vpn" } }] };
    const { agent, model } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      again,
      again,
      again,
      again,
      again,
    ]);
    await replyOf(agent, turn);
    expect(model.calls).toHaveLength(5);
  });

  it("marks the instructions for the prompt cache, so the steps of a reply reuse them", async () => {
    const { agent, model } = setup(hoursScript());
    await replyOf(agent, turn);
    const [system] = model.calls[0]!.prompt;
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("Você é o Nexo Assist");
    expect(system?.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
  });

  it("caps the tokens of each step", async () => {
    const { agent, model } = setup(hoursScript());
    await replyOf(agent, turn);
    expect(model.calls[0]?.maxOutputTokens).toBe(800);
  });

  it("gives the ticket tools the employee of the turn, from the session", async () => {
    lookups.length = 0;
    const { agent } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      { toolCalls: [{ toolName: "listMyTickets", input: { scope: "open" } }] },
      { toolCalls: [{ toolName: "getTicket", input: { ticketId: "INC-20311" } }] },
      { text: "Pronto." },
    ]);
    await replyOf(agent, { ...turn, employeeId: "emp-bruno", text: "Meus chamados" });
    expect(lookups).toEqual(["emp-bruno", "emp-bruno"]);
  });

  it("ends the reply once it offers a choice of tickets, without calling the model again", async () => {
    // A fourth step would fail: the script has only three.
    const { agent, model } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      { toolCalls: [{ toolName: "listMyTickets", input: { scope: "open" } }] },
      {
        toolCalls: [
          {
            toolName: "offerTicketChoice",
            input: { question: "Você tem 2 chamados abertos. Sobre qual deles quer saber?", ticketIds: ["INC-20311", "REQ-10442"] },
          },
        ],
      },
    ]);
    const reply = await replyOf(agent, { ...turn, text: "Qual o status do meu chamado?" });
    expect(reply.toolCalls.map((call) => call.toolName)).toEqual(["recordDecision", "listMyTickets", "offerTicketChoice"]);
    expect(model.calls).toHaveLength(3);
  });

  it("ends the reply once it offers quick replies", async () => {
    const { agent, model } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      {
        toolCalls: [
          {
            toolName: "offerReplies",
            input: { question: "Quer que eu chame um analista?", options: ["Falar com um analista", "Não, obrigado"] },
          },
        ],
      },
    ]);
    await replyOf(agent, turn);
    expect(model.calls).toHaveLength(2);
  });

  it("ends the reply once it answered and only updated the working memory, so the answer is not written twice", async () => {
    // A third step would fail: the script has only two.
    const { agent, model, memory } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      { text: answer, toolCalls: [{ toolName: "updateWorkingMemory", input: { memory: "# Caso\n- Problema: horário" } }] },
    ]);
    expect((await replyOf(agent, turn)).text).toBe(answer);
    expect(model.calls).toHaveLength(2);
    expect(await memory.getWorkingMemory({ threadId: "conv-1", resourceId: "emp-ana" })).toContain("horário");
  });

  it("goes on when the offer could not be shown, so the agent explains instead of answering nothing", async () => {
    // None of these numbers is the employee's: the list has nothing to show.
    const { agent, model } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      {
        toolCalls: [
          { toolName: "offerTicketChoice", input: { question: "Sobre qual deles?", ticketIds: ["INC-99998", "INC-99999"] } },
        ],
      },
      { text: "Não consegui mostrar seus chamados agora." },
    ]);
    expect((await replyOf(agent, turn)).text).toBe("Não consegui mostrar seus chamados agora.");
    expect(model.calls).toHaveLength(3);
  });

  it("goes on when the model wrote an offer the schema refuses", async () => {
    const { agent, model } = setup([
      { toolCalls: [{ toolName: "recordDecision", input: decision }] },
      { toolCalls: [{ toolName: "offerReplies", input: { question: "Quer ajuda?", options: ["Sim"] } }] },
      { text: "Quer que eu chame um analista?" },
    ]);
    expect((await replyOf(agent, turn)).text).toBe("Quer que eu chame um analista?");
    expect(model.calls).toHaveLength(3);
  });

  it("ends the reply with the failure of the model", async () => {
    const { agent } = setup([new Error("overloaded")]);
    await expect(replyOf(agent, turn)).rejects.toThrow();
  });
});
