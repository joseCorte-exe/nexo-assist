import type { DecisionRecord, KbArticle } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createNexoAgent, createMemory, streamReply } from "./agent";
import { promptText, scriptedModel } from "./testing";
import type { HelpCenter } from "./tools";

const hours: KbArticle = {
  id: "kb-service-desk-hours",
  title: "Horário do service desk",
  content: "De segunda a sexta, das 8h às 18h. Chamados críticos têm plantão 24 horas.",
  category: "other",
};
const helpCenter: HelpCenter = { searchArticles: async () => ({ ok: true, data: [hours] }) };

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
  const agent = createNexoAgent({ model, memory, helpCenter });
  return { model, memory, agent };
}

const turn = { conversationId: "conv-1", employeeId: "emp-ana", text: "Qual o horário do service desk?" };

describe("streamReply", () => {
  it("answers and gives back the text and the decision of the turn", async () => {
    const { agent } = setup(hoursScript());
    const reply = streamReply(agent, turn);
    expect(await reply.finished).toEqual({
      ok: true,
      text: answer,
      decision: { ...decision, toolsUsed: ["recordDecision", "searchArticles"] },
    });
  });

  it("forces recordDecision in the first step and lets the model choose afterwards", async () => {
    const { agent, model } = setup(hoursScript());
    await streamReply(agent, turn).finished;
    expect(model.calls[0]?.toolChoice).toEqual({ type: "tool", toolName: "recordDecision" });
    expect(model.calls[1]?.toolChoice).toEqual({ type: "auto" });
  });

  it("gives the model the article the help center found", async () => {
    const { agent, model } = setup(hoursScript());
    await streamReply(agent, turn).finished;
    expect(promptText(model.calls[2]!)).toContain("das 8h às 18h");
  });

  it("remembers the earlier turns of the same conversation", async () => {
    const model = scriptedModel([
      ...hoursScript(),
      { toolCalls: [{ toolName: "recordDecision", input: { ...decision, understanding: "Pergunta de seguimento" } }] },
      { text: "Sim, de segunda a sexta." },
    ]);
    const agent = createNexoAgent({ model, memory: createMemory({ url: ":memory:" }), helpCenter });
    await streamReply(agent, turn).finished;
    await streamReply(agent, { ...turn, text: "E no sábado?" }).finished;

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
    const agent = createNexoAgent({ model, memory: createMemory({ url: ":memory:" }), helpCenter });
    await streamReply(agent, turn).finished;
    await streamReply(agent, { conversationId: "conv-2", employeeId: "emp-bruno", text: "Oi" }).finished;
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
    await streamReply(agent, turn).finished;
    expect(model.calls).toHaveLength(5);
  });

  it("marks the instructions for the prompt cache, so the steps of a reply reuse them", async () => {
    const { agent, model } = setup(hoursScript());
    await streamReply(agent, turn).finished;
    const [system] = model.calls[0]!.prompt;
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("Você é o Nexo Assist");
    expect(system?.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
  });

  it("caps the tokens of each step", async () => {
    const { agent, model } = setup(hoursScript());
    await streamReply(agent, turn).finished;
    expect(model.calls[0]?.maxOutputTokens).toBe(800);
  });

  it("reports a failure of the model instead of throwing", async () => {
    const { agent } = setup([new Error("overloaded")]);
    const reply = await streamReply(agent, turn).finished;
    expect(reply.ok).toBe(false);
  });
});
