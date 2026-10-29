import type { NexoUIMessage } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { liveTurns, messageCount } from "./chat-turns";

const decision = {
  understanding: "Quer saber o horário do service desk",
  action: "Responder pela central de ajuda",
  confidence: 0.93,
  reason: "Existe um artigo sobre o horário.",
};

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
    expect(turns).toEqual([
      { kind: "employee", id: "u1", text: "Qual o horário?", unsent: false },
      { kind: "agent", id: "u1-reply", text: "", decision: null, steps: [], phase: "thinking" },
    ]);
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

  it("marks the message as not sent when nothing of the reply arrived, with no reply under it", () => {
    expect(liveTurns([user("u1", "Oi")], "error")).toEqual([{ kind: "employee", id: "u1", text: "Oi", unsent: true }]);
  });

  it("fails when the reply started but brought no answer", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available")])], "error");
    expect(turns.at(-1)).toMatchObject({ phase: "failed" });
    expect(turns[0]).toMatchObject({ unsent: false });
  });

  it("is interrupted when the answer stopped in the middle, keeping what arrived", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([{ type: "text", text: "Das 8h" }])], "error");
    expect(turns.at(-1)).toMatchObject({ text: "Das 8h", phase: "interrupted" });
  });

  it("draws a saved reply as it was drawn live, a failed search included", () => {
    const saved = agent([recordDecision("output-available"), search("output-available", false), { type: "text", text: "Fora do ar." }]);
    const turns = liveTurns([user("u1", "Oi"), saved, user("u2", "E agora?")], "submitted");
    expect(turns[1]).toEqual({
      kind: "agent",
      id: "a1",
      text: "Fora do ar.",
      decision,
      steps: [{ tool: "searchArticles", state: "failed" }],
      phase: "done",
    });
  });

  it("only shows actions the screen has a label for", () => {
    const memory = { type: "tool-updateWorkingMemory", toolCallId: "c3", state: "output-available", input: {}, output: {} };
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), memory as NexoUIMessage["parts"][number]])], "ready");
    expect(turns.at(-1)).toMatchObject({ steps: [] });
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

const conversation = (count: number) =>
  ({ type: "data-conversation", data: { id: "conv-1", state: "with_agent", messageCount: count } }) as NexoUIMessage["parts"][number];

describe("messageCount", () => {
  it("is the count the page loaded with while no reply brought a newer one", () => {
    expect(messageCount([user("u1", "Oi"), agent([{ type: "text", text: "Oi!" }])], "ready", 4)).toBe(4);
  });

  it("is the count of the last reply that brought one", () => {
    const messages = [user("u1", "Oi"), agent([conversation(5)]), user("u2", "E?"), agent([conversation(6)])];
    expect(messageCount(messages, "ready", 4)).toBe(6);
  });

  it("counts a message on its way at once", () => {
    expect(messageCount([user("u1", "Oi"), agent([conversation(5)]), user("u2", "E?")], "submitted", 4)).toBe(6);
  });

  it("does not count a message that never reached the server", () => {
    expect(messageCount([user("u1", "Oi"), agent([conversation(5)]), user("u2", "E?")], "error", 4)).toBe(5);
  });
});
