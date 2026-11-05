import { describe, expect, it } from "vitest";
import { type Counter, counterOf, counterWords } from "./counter";

const withAgent = { state: "with_agent" as const, limitReached: false, analystName: null };

describe("counterOf", () => {
  it("counts the conversation until the last five", () => {
    expect(counterOf(0, withAgent)).toEqual({ kind: "count", count: 0 });
    expect(counterOf(24, withAgent)).toEqual({ kind: "count", count: 24 });
  });

  it("tells what is left from 25 on, while the Nexo answers", () => {
    expect(counterOf(25, withAgent)).toEqual({ kind: "left", left: 5 });
    expect(counterOf(29, withAgent)).toEqual({ kind: "left", left: 1 });
  });

  it("does not warn while an analyst has her: nothing changes for her at 30", () => {
    expect(counterOf(27, { state: "with_analyst", limitReached: false, analystName: "Rafael Lima" })).toEqual({ kind: "count", count: 27 });
  });

  it("past the limit with an analyst, says who stays instead of counting past 30", () => {
    expect(counterOf(31, { state: "with_analyst", limitReached: true, analystName: "Rafael Lima" })).toEqual({ kind: "analyst", name: "Rafael Lima" });
    expect(counterOf(30, { state: "waiting_for_analyst", limitReached: true, analystName: null })).toEqual({ kind: "analyst", name: null });
  });

  it("a conversation closed by the limit counts 30 of 30", () => {
    expect(counterOf(30, { state: "closed", limitReached: true, analystName: null })).toEqual({ kind: "count", count: 30 });
  });
});

describe("counterWords", () => {
  it.each<[Counter, string]>([
    [{ kind: "count", count: 12 }, "12/30 mensagens nesta sessão"],
    [{ kind: "left", left: 5 }, "Restam 5 mensagens nesta sessão"],
    [{ kind: "left", left: 1 }, "Resta 1 mensagem nesta sessão"],
    [{ kind: "analyst", name: "Rafael Lima" }, "Limite do Nexo atingido · Rafael Lima continua com você"],
    [{ kind: "analyst", name: null }, "Limite do Nexo atingido · um analista continua com você"],
  ])("%j", (counter, words) => {
    expect(counterWords(counter)).toBe(words);
  });
});
