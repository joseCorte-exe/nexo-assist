import type { NexoUIMessage } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { summarizeTurn } from "./turn-summary";

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
