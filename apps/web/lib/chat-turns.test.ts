import type { ChatMessage } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import type { NexoUIMessage } from "./chat-message";
import { liveTurns, turnsFromHistory } from "./chat-turns";

const decision = {
  understanding: "Quer saber o horário do service desk",
  action: "Responder pela central de ajuda",
  confidence: 0.93,
  reason: "Existe um artigo sobre o horário.",
};
const at = "2026-10-26T13:00:00.000Z";

describe("turnsFromHistory", () => {
  it("shows each saved message, the agent ones with their decision and the actions that ran", () => {
    const history: ChatMessage[] = [
      { id: "m1", author: "employee", text: "Qual o horário?", createdAt: at, decision: null },
      {
        id: "m2",
        author: "agent",
        text: "Das 8h às 18h.",
        createdAt: at,
        decision: { ...decision, toolsUsed: ["recordDecision", "searchArticles"] },
      },
    ];
    expect(turnsFromHistory(history)).toEqual([
      { kind: "employee", id: "m1", text: "Qual o horário?" },
      {
        kind: "agent",
        id: "m2",
        text: "Das 8h às 18h.",
        decision,
        steps: [{ tool: "searchArticles", state: "done" }],
        phase: "done",
      },
    ]);
  });

  it("keeps the reduced record without confidence", () => {
    const [turn] = turnsFromHistory([
      {
        id: "m2",
        author: "agent",
        text: "Oi!",
        createdAt: at,
        decision: { understanding: "", action: "", confidence: null, reason: null, toolsUsed: [] },
      },
    ]);
    expect(turn).toMatchObject({ decision: { understanding: "", action: "", confidence: null, reason: null } });
  });

  it("only shows actions the screen has a label for", () => {
    const [turn] = turnsFromHistory([
      {
        id: "m2",
        author: "agent",
        text: "Pronto.",
        createdAt: at,
        decision: { ...decision, toolsUsed: ["recordDecision", "updateWorkingMemory", "redirectOutOfScope"] },
      },
    ]);
    expect(turn).toMatchObject({ steps: [{ tool: "redirectOutOfScope", state: "done" }] });
  });
});

const user = (id: string, text: string): NexoUIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const recordDecision = (state: "input-streaming" | "input-available" | "output-available") =>
  ({
    type: "tool-recordDecision",
    toolCallId: "c1",
    state,
    input: state === "input-streaming" ? undefined : decision,
    output: state === "output-available" ? { recorded: true } : undefined,
  }) as NexoUIMessage["parts"][number];
const search = (state: "input-available" | "output-available", ok = true) =>
  ({
    type: "tool-searchArticles",
    toolCallId: "c2",
    state,
    input: { query: "horário" },
    output: state === "output-available" ? (ok ? { ok: true, articles: [] } : { ok: false, message: "fora" }) : undefined,
  }) as NexoUIMessage["parts"][number];
const agent = (parts: NexoUIMessage["parts"]): NexoUIMessage => ({ id: "a1", role: "assistant", parts });

describe("liveTurns", () => {
  it("shows the agent thinking as soon as the message goes, before anything arrives", () => {
    const turns = liveTurns([user("u1", "Qual o horário?")], "submitted");
    expect(turns.at(-1)).toEqual({ kind: "agent", id: "u1-reply", text: "", decision: null, steps: [], phase: "thinking" });
  });

  it("keeps thinking while the decision is still being written", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("input-streaming")])], "streaming");
    expect(turns.at(-1)).toMatchObject({ decision: null, phase: "thinking" });
  });

  it("has the decision as soon as recordDecision arrives, before the answer", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("input-available")])], "streaming");
    expect(turns.at(-1)).toMatchObject({ decision, phase: "working" });
  });

  it("shows a tool running, then done", () => {
    const running = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), search("input-available")])], "streaming");
    expect(running.at(-1)).toMatchObject({ steps: [{ tool: "searchArticles", state: "running" }], phase: "working" });
    const done = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), search("output-available")])], "streaming");
    expect(done.at(-1)).toMatchObject({ steps: [{ tool: "searchArticles", state: "done" }] });
  });

  it("marks a tool that came back without an answer", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), search("output-available", false)])], "ready");
    expect(turns.at(-1)).toMatchObject({ steps: [{ tool: "searchArticles", state: "failed" }] });
  });

  it("joins the text of every step and is writing while it streams", () => {
    const turns = liveTurns(
      [
        user("u1", "Oi"),
        agent([recordDecision("output-available"), { type: "text", text: "Das 8h " }, { type: "text", text: "às 18h." }]),
      ],
      "streaming",
    );
    expect(turns.at(-1)).toMatchObject({ text: "Das 8h às 18h.", phase: "writing" });
  });

  it("is done when the chat is ready again", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), { type: "text", text: "Oi!" }])], "ready");
    expect(turns.at(-1)).toMatchObject({ phase: "done" });
  });

  it("fails when the agent could not answer anything", () => {
    expect(liveTurns([user("u1", "Oi")], "error").at(-1)).toMatchObject({ kind: "agent", phase: "failed" });
    expect(liveTurns([user("u1", "Oi"), agent([recordDecision("output-available")])], "error").at(-1)).toMatchObject({
      phase: "failed",
    });
  });

  it("is interrupted when the answer stopped in the middle, keeping what arrived", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([{ type: "text", text: "Das 8h" }])], "error");
    expect(turns.at(-1)).toMatchObject({ text: "Das 8h", phase: "interrupted" });
  });

  it("only changes the phase of the last reply: earlier ones stay done", () => {
    const turns = liveTurns(
      [user("u1", "Oi"), agent([{ type: "text", text: "Oi!" }]), user("u2", "Tudo bem?")],
      "submitted",
    );
    expect(turns.map((turn) => (turn.kind === "agent" ? turn.phase : turn.kind))).toEqual([
      "employee",
      "done",
      "employee",
      "thinking",
    ]);
  });
});
