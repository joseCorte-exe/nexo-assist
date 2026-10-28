import { describe, expect, it } from "vitest";
import { summarizeTurn } from "./turn-summary";

const decision = {
  understanding: "Quer saber o horário do service desk",
  action: "Responder pela central de ajuda",
  confidence: 0.93,
  reason: "Existe um artigo sobre o horário.",
};

describe("summarizeTurn", () => {
  it("takes the decision from recordDecision and lists the tools in the order they ran", () => {
    expect(
      summarizeTurn([
        { toolName: "recordDecision", args: decision },
        { toolName: "searchArticles", args: { query: "horário" } },
      ]),
    ).toEqual({ ...decision, toolsUsed: ["recordDecision", "searchArticles"] });
  });

  it("lists a tool once even when it ran more than once", () => {
    const summary = summarizeTurn([
      { toolName: "recordDecision", args: decision },
      { toolName: "searchArticles", args: { query: "vpn" } },
      { toolName: "searchArticles", args: { query: "vpn 809" } },
    ]);
    expect(summary.toolsUsed).toEqual(["recordDecision", "searchArticles"]);
  });

  it("leaves out the memory tool, which is not an action of the agent", () => {
    const summary = summarizeTurn([
      { toolName: "recordDecision", args: decision },
      { toolName: "updateWorkingMemory", args: { memory: "..." } },
    ]);
    expect(summary.toolsUsed).toEqual(["recordDecision"]);
  });

  it("saves the reduced record, without confidence or reason, when recordDecision did not come", () => {
    expect(summarizeTurn([{ toolName: "searchArticles", args: { query: "vpn" } }])).toEqual({
      understanding: "",
      action: "",
      confidence: null,
      reason: null,
      toolsUsed: ["searchArticles"],
    });
  });

  it("saves the reduced record when recordDecision came with invalid data", () => {
    const summary = summarizeTurn([{ toolName: "recordDecision", args: { ...decision, confidence: 1.5 } }]);
    expect(summary.confidence).toBeNull();
    expect(summary.toolsUsed).toEqual(["recordDecision"]);
  });

  it("keeps the first valid decision when the agent recorded more than one", () => {
    const later = { ...decision, action: "Outra coisa" };
    const summary = summarizeTurn([
      { toolName: "recordDecision", args: { confidence: "alta" } },
      { toolName: "recordDecision", args: decision },
      { toolName: "recordDecision", args: later },
    ]);
    expect(summary.action).toBe(decision.action);
  });
});
