import { describe, expect, it } from "vitest";
import type { conversations } from "@/db/schema";
import { attends, moves } from "./conversation-moves";

// Who may move a conversation, and from where (ARQUITETURA.md, sections 2 and 6), without a database: the rules are
// written once, here, and the update only checks the row did not change since it was read.

type Row = typeof conversations.$inferSelect;
const NOW = new Date("2026-10-26T13:05:00Z");
const rafael = { id: "analyst-rafael", name: "Rafael Lima", email: "rafael.lima@nexo.com.br", level: "N2", available: true } as const;
const juliana = { id: "analyst-juliana", name: "Juliana Costa", email: "juliana.costa@nexo.com.br", level: "N1", available: true } as const;

const row = (fields: Partial<Row>): Row => ({
  id: "conv-ana",
  employeeId: "emp-ana",
  state: "with_agent",
  outcome: null,
  targetLevel: null,
  transferReason: null,
  transferSummary: null,
  transferConfidence: null,
  analystId: null,
  ticketId: null,
  messageCount: 2,
  waitUntil: null,
  createdAt: NOW,
  firstResponseAt: NOW,
  closedAt: null,
  transferredAt: null,
  assumedAt: null,
  lastActivityAt: NOW,
  employeeSeenAt: null,
  employeeTypingUntil: null,
  needsAnalystSince: null,
  version: 0,
  ...fields,
});

const withAgent = row({});
const waiting = row({ state: "waiting_for_analyst", targetLevel: "N2" });
const withRafael = row({ state: "with_analyst", analystId: rafael.id });
const closedByRafael = row({ state: "closed", outcome: "closed_by_analyst", analystId: rafael.id });
const closedByHer = row({ state: "closed", outcome: "resolved_by_agent" });

const transfer = moves.transfer({
  level: "N2",
  reason: "overdue",
  summary: "Notebook lento.",
  ticketId: "INC-20311",
  waitUntil: NOW,
  confidence: 0.82,
  turnStartedAt: new Date(NOW.getTime() - 4_000),
});

describe("transfer", () => {
  it("only moves a conversation the agent attends", () => {
    expect(transfer.decide(withAgent)).toBe("apply");
    for (const taken of [waiting, withRafael, closedByHer]) expect(transfer.decide(taken)).toEqual({ refused: "not_with_agent" });
  });

  it("waits for the level with the summary and the confidence, and notes where it went", () => {
    expect(transfer.set(NOW)).toMatchObject({
      state: "waiting_for_analyst",
      targetLevel: "N2",
      transferConfidence: 0.82,
      transferredAt: NOW,
      // She needs an analyst from the message the transferring reply answered.
      needsAnalystSince: new Date(NOW.getTime() - 4_000),
    });
    expect(transfer.note).toEqual({ authorId: null, note: { event: "transferred", level: "N2" }, text: "Transferida para o Suporte N2.", memory: false });
  });

  it("puts its note after the reply that announced it, even in the millisecond the turn started", () => {
    const started = new Date(NOW.getTime() - 4_000);
    expect(transfer.notePlace?.(NOW)).toEqual(NOW);
    expect(transfer.notePlace?.(started)).toEqual(new Date(started.getTime() + 2));
  });
});

describe("assume", () => {
  it("takes a conversation with the agent or waiting, at any level", () => {
    expect(moves.assume(juliana).decide(withAgent)).toBe("apply");
    expect(moves.assume(juliana).decide(waiting)).toBe("apply");
  });

  it("answers the same to who already has it, and refuses another analyst's or a closed one", () => {
    expect(moves.assume(rafael).decide(withRafael)).toBe("already");
    expect(moves.assume(juliana).decide(withRafael)).toEqual({ refused: "taken" });
    expect(moves.assume(rafael).decide(closedByRafael)).toEqual({ refused: "closed" });
  });

  it("pauses the agent with the analyst and says so to the agent too", () => {
    expect(moves.assume(rafael).set(NOW)).toEqual({ state: "with_analyst", analystId: rafael.id, assumedAt: NOW });
    expect(moves.assume(rafael).note).toEqual({
      authorId: rafael.id,
      note: { event: "assumed", level: "N2", analystName: "Rafael Lima" },
      text: "Rafael Lima, analista do Suporte N2, assumiu a conversa. O agent está pausado até a conversa voltar para ele.",
      memory: true,
    });
  });
});

describe("release", () => {
  it("hands back a waiting conversation, or one this analyst attends", () => {
    expect(moves.release(juliana).decide(waiting)).toBe("apply");
    expect(moves.release(rafael).decide(withRafael)).toBe("apply");
  });

  it("answers the same when the agent has it, and refuses another analyst's or a closed one", () => {
    expect(moves.release(rafael).decide(withAgent)).toBe("already");
    expect(moves.release(juliana).decide(withRafael)).toEqual({ refused: "taken" });
    expect(moves.release(rafael).decide(closedByHer)).toEqual({ refused: "closed" });
  });

  it("gives it to the agent with nobody waited for", () => {
    expect(moves.release(rafael).set(NOW)).toEqual({ state: "with_agent", analystId: null, assumedAt: null, waitUntil: null });
    expect(moves.release(rafael).note.note).toEqual({ event: "released", analystName: "Rafael Lima" });
  });
});

describe("attends", () => {
  it("lets only the analyst attending write, and says why to anyone else", () => {
    expect(attends(withRafael, rafael)).toBe("apply");
    expect(attends(withRafael, juliana)).toEqual({ refused: "taken" });
    expect(attends(waiting, rafael)).toEqual({ refused: "not_assumed" });
    expect(attends(closedByRafael, rafael)).toEqual({ refused: "closed" });
  });
});

describe("close", () => {
  it("ends a conversation this analyst attends", () => {
    expect(moves.close(rafael).decide(withRafael)).toBe("apply");
    expect(moves.close(rafael).set(NOW)).toEqual({ state: "closed", outcome: "closed_by_analyst", closedAt: NOW });
  });

  it("answers the same when they closed it, and refuses one they do not attend", () => {
    expect(moves.close(rafael).decide(closedByRafael)).toBe("already");
    expect(moves.close(juliana).decide(closedByRafael)).toEqual({ refused: "closed" });
    expect(moves.close(rafael).decide(closedByHer)).toEqual({ refused: "closed" });
    expect(moves.close(juliana).decide(withRafael)).toEqual({ refused: "taken" });
    expect(moves.close(rafael).decide(waiting)).toEqual({ refused: "not_assumed" });
  });
});
