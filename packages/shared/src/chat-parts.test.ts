import { describe, expect, it } from "vitest";
import type { NexoUIMessage } from "./chat";
import { decisionOf, isRefusedInput, replyText, shownDraft, summarizeTurn, textOf, withToolErrors } from "./chat-parts";

const decision = {
  understanding: "Quer saber o horário do service desk",
  action: "Responder pela central de ajuda",
  confidence: 0.93,
  reason: "Existe um artigo sobre o horário.",
};

type Part = NexoUIMessage["parts"][number];

/** A tool part as the reply streamed it, finished. */
const tool = (name: string, input: unknown, output: unknown = { ok: true }) =>
  ({ type: `tool-${name}`, toolCallId: `call-${name}`, state: "output-available", input, output }) as Part;
const text = (value: string): Part => ({ type: "text", text: value });

describe("summarizeTurn", () => {
  it("takes the record from recordDecision and lists the tools in the order they ran", () => {
    expect(
      summarizeTurn([
        tool("recordDecision", decision, { recorded: true }),
        tool("searchArticles", { query: "horário" }),
        text("Das 8h às 18h."),
      ]),
    ).toEqual({ record: decision, toolsUsed: ["recordDecision", "searchArticles"] });
  });

  it("lists a tool once even when it ran more than once", () => {
    const summary = summarizeTurn([
      tool("recordDecision", decision),
      tool("searchArticles", { query: "vpn" }),
      tool("searchArticles", { query: "vpn 809" }),
    ]);
    expect(summary.toolsUsed).toEqual(["recordDecision", "searchArticles"]);
  });

  it("leaves out the memory tool, which is not an action of the agent", () => {
    const summary = summarizeTurn([tool("recordDecision", decision), tool("updateWorkingMemory", { memory: "..." })]);
    expect(summary.toolsUsed).toEqual(["recordDecision"]);
  });

  it("has no record, the reduced record, when recordDecision did not come", () => {
    expect(summarizeTurn([tool("searchArticles", { query: "vpn" }), text("Oi!")])).toEqual({
      record: null,
      toolsUsed: ["searchArticles"],
    });
  });

  it("has no record when recordDecision came with invalid data", () => {
    expect(summarizeTurn([tool("recordDecision", { ...decision, confidence: 1.5 })])).toEqual({
      record: null,
      toolsUsed: ["recordDecision"],
    });
  });

  it("keeps the first valid record when the agent recorded more than one", () => {
    const summary = summarizeTurn([
      tool("recordDecision", { confidence: "alta" }),
      tool("recordDecision", decision),
      tool("recordDecision", { ...decision, action: "Outra coisa" }),
    ]);
    expect(summary.record?.action).toBe(decision.action);
  });
});

describe("textOf", () => {
  it("joins the text of every step, leaving the tools out", () => {
    expect(textOf([tool("recordDecision", decision), text("Das 8h "), tool("searchArticles", {}), text("às 18h.")])).toBe(
      "Das 8h às 18h.",
    );
  });
});

describe("decisionOf", () => {
  it("is the first valid record", () => {
    expect(decisionOf([tool("recordDecision", { confidence: "alta" }), tool("recordDecision", decision)])).toEqual(decision);
  });

  it("waits while the record is still streaming, since its input may be partial", () => {
    const streaming = { type: "tool-recordDecision", toolCallId: "c1", state: "input-streaming", input: decision } as Part;
    expect(decisionOf([streaming])).toBeNull();
  });
});

describe("withToolErrors", () => {
  it("saves a tool input the agent refused as an error of the tool, so the reply stays valid", () => {
    const refused = tool("draftTicket", { operation: "create" }, { error: true, message: "Faltam: título." });
    expect(withToolErrors([refused, text("Pronto.")])).toEqual([
      { type: "tool-draftTicket", toolCallId: "call-draftTicket", state: "output-error", input: { operation: "create" }, errorText: "Faltam: título." },
      text("Pronto."),
    ]);
  });

  it("keeps every other part as it was", () => {
    const parts = [tool("searchArticles", { query: "vpn" }, { ok: false, message: "fora do ar" }), text("Oi")];
    expect(withToolErrors(parts)).toEqual(parts);
  });
});

describe("shownDraft", () => {
  const draft = {
    id: "draft-1",
    number: 381,
    operation: "create",
    status: "pending",
    ticketId: null,
    type: "INC",
    title: "VPN não conecta no notebook",
    description: "Erro 809 desde ontem.",
    category: "network_vpn",
    subcategory: "VPN",
    priority: "high",
    affected: "only_me",
    rejectedReason: null,
    deadline: "4 horas úteis",
    dueAt: "2026-10-26T17:00:00.000Z",
    createdAt: "2026-10-26T13:00:00.000Z",
  };

  it("is the draft a finished draftTicket showed the employee", () => {
    expect(shownDraft(tool("draftTicket", {}, { ok: true, draft, dueText: "hoje, até 14:00" }))).toEqual(draft);
  });

  it("is nothing for a draft not made, a call still running or another tool", () => {
    expect(shownDraft(tool("draftTicket", {}, { ok: false, reason: "unavailable", message: "Fora do ar." }))).toBeNull();
    expect(shownDraft({ type: "tool-draftTicket", toolCallId: "c", state: "input-available", input: {} } as Part)).toBeNull();
    expect(shownDraft(tool("getTicket", {}, { ok: true, draft }))).toBeNull();
    expect(shownDraft(text("Oi"))).toBeNull();
  });
});

describe("isRefusedInput", () => {
  it("tells apart what Mastra hands the model for an input that failed the schema", () => {
    expect(isRefusedInput({ error: true, message: "Para criar, falta title." })).toBe(true);
    expect(isRefusedInput({ ok: false, reason: "unavailable", message: "Fora do ar." })).toBe(false);
    expect(isRefusedInput(undefined)).toBe(false);
  });
});

describe("replyText", () => {
  const offer = (question: string) =>
    ({ type: "tool-offerReplies", toolCallId: "o1", state: "output-available", input: { question, options: ["Falar com um analista", "Não, obrigado"] }, output: { ok: true } }) as NexoUIMessage["parts"][number];
  const ticket = {
    type: "tool-getTicket",
    toolCallId: "g1",
    state: "output-available",
    input: { ticketId: "INC-20311" },
    output: { ok: true, ticket: { id: "INC-20311", title: "Notebook lento após atualização do Windows" } },
  } as unknown as NexoUIMessage["parts"][number];

  it("is the text of the reply when it has one", () => {
    expect(replyText([{ type: "text", text: "Encaminhei para o Suporte N2." }])).toBe("Encaminhei para o Suporte N2.");
  });

  it("adds the question of an offer the text does not already ask", () => {
    const question = "Está sem atualização há 6 dias. Quer que eu chame um analista?";
    expect(replyText([ticket, offer(question)])).toBe("Chamado INC-20311 · Notebook lento após atualização do Windows\nEstá sem atualização há 6 dias. Quer que eu chame um analista?");
    expect(replyText([{ type: "text", text: question }, offer(question)])).toBe(question);
  });

  it("names the ticket it showed when there is no text at all", () => {
    expect(replyText([ticket])).toBe("Chamado INC-20311 · Notebook lento após atualização do Windows");
  });
});
