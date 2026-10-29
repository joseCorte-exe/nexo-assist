import type { NexoUIMessage, TicketCard, TicketSummary } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { liveTurns, messageCount, ticketChoiceText } from "./chat-turns";

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
      { kind: "agent", id: "u1-reply", text: "", decision: null, steps: [], blocks: [], offer: null, phase: "thinking" },
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
    expect(running.at(-1)).toMatchObject({ steps: [{ label: "buscando na central de ajuda", state: "running" }], phase: "working" });
    const done = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), search("output-available")])], "streaming");
    expect(done.at(-1)).toMatchObject({ steps: [{ label: "buscou na central de ajuda", state: "done" }] });
  });

  it("marks a tool that came back without an answer", () => {
    const turns = liveTurns([user("u1", "Oi"), agent([recordDecision("output-available"), search("output-available", false)])], "ready");
    expect(turns.at(-1)).toMatchObject({ steps: [{ label: "não acessou a central de ajuda", state: "failed" }] });
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
      steps: [{ key: "c2", label: "não acessou a central de ajuda", state: "failed" }],
      blocks: [{ kind: "text", key: "text-2", text: "Fora do ar." }],
      offer: null,
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

// Feature 3: the ticket lookup.

type Part = NexoUIMessage["parts"][number];
const tool = (name: string, toolCallId: string, input: unknown, output?: unknown) =>
  ({
    type: `tool-${name}`,
    toolCallId,
    state: output === undefined ? "input-available" : "output-available",
    input,
    output,
  }) as Part;
const text = (value: string): Part => ({ type: "text", text: value });

const notebook: TicketSummary = {
  id: "INC-20311",
  title: "Notebook lento após atualização do Windows",
  status: "waiting_for_analyst",
  createdAt: "2026-10-20T13:00:00.000Z",
  overdue: true,
};
const sharepoint: TicketSummary = { ...notebook, id: "INC-20298", title: "Acesso à pasta Financeiro no SharePoint", status: "in_progress", overdue: false };
const card: TicketCard = {
  ...notebook,
  type: "INC",
  description: "Lentidão geral.",
  category: "hardware",
  subcategory: "Notebook",
  priority: "medium",
  assigneeName: null,
  updatedAt: notebook.createdAt,
  dueAt: "2026-10-23T13:00:00.000Z",
  daysSinceUpdate: 6,
  deadline: "3 dias úteis",
  lastItUpdate: null,
  checkedAt: "2026-10-26T13:00:00.000Z",
};
const replies = ["Falar com um analista", "Adicionar informação", "Não, obrigado"];

const listReply = agent([
  recordDecision("output-available"),
  tool("listMyTickets", "c2", { scope: "open" }, { ok: true, tickets: [notebook, sharepoint] }),
  text("Você tem 2 chamados abertos. Sobre qual deles quer saber?"),
  tool("offerTicketChoice", "c3", { ticketIds: ["INC-20311", "INC-20298"] }, { ok: true, tickets: [notebook, sharepoint] }),
]);
const ticketReply = agent([
  recordDecision("output-available"),
  tool("getTicket", "c2", { ticketId: "INC-20311" }, { ok: true, ticket: card }),
  text("Está sem atualização há 6 dias. Quer que eu chame um analista?"),
  tool("offerReplies", "c3", { options: replies }, { shown: true }),
]);

describe("liveTurns, looking up tickets", () => {
  it("names the lookup of the tickets in the action line", () => {
    const steps = (output?: unknown) =>
      (liveTurns([user("u1", "Meu chamado?"), agent([tool("listMyTickets", "c2", { scope: "open" }, output)])], "streaming").at(-1) as { steps: unknown })
        .steps;
    expect(steps()).toEqual([{ key: "c2", label: "consultando seus chamados", state: "running" }]);
    expect(steps({ ok: true, tickets: [] })).toEqual([{ key: "c2", label: "consultou seus chamados", state: "done" }]);
    expect(steps({ ok: false, message: "fora" })).toEqual([{ key: "c2", label: "não acessou seus chamados", state: "failed" }]);
  });

  it("names the ticket it looks up, and the deadline it worked out once the ticket came", () => {
    const steps = (output?: unknown) =>
      (liveTurns([user("u1", "INC-20311"), agent([tool("getTicket", "c2", { ticketId: "INC-20311" }, output)])], "streaming").at(-1) as { steps: unknown })
        .steps;
    expect(steps()).toEqual([{ key: "c2", label: "consultando o INC-20311", state: "running" }]);
    expect(steps({ ok: true, ticket: card })).toEqual([
      { key: "c2", label: "consultou o INC-20311", state: "done" },
      { key: "c2-deadline", label: "calculou o prazo", state: "done" },
    ]);
    expect(steps({ ok: false, reason: "not_found", message: "?" })).toEqual([
      { key: "c2", label: "não encontrou o INC-20311", state: "failed" },
    ]);
    expect(steps({ ok: false, reason: "unavailable", message: "?" })).toEqual([
      { key: "c2", label: "não acessou o INC-20311", state: "failed" },
    ]);
  });

  it("shows no action for an offer: it is a question to the employee, not something the agent did", () => {
    const turn = liveTurns([user("u1", "Meu chamado?"), listReply], "ready").at(-1);
    expect(turn).toMatchObject({ steps: [{ label: "consultou seus chamados" }] });
  });

  it("asks with the text and offers the list after it, open while nobody chose", () => {
    const turn = liveTurns([user("u1", "Meu chamado?"), listReply], "ready").at(-1);
    expect(turn).toMatchObject({
      blocks: [{ kind: "text", text: "Você tem 2 chamados abertos. Sobre qual deles quer saber?" }],
      offer: { kind: "tickets", tickets: [notebook, sharepoint], chosen: null, open: true },
    });
  });

  it("marks the ticket the next message chose, and closes the list", () => {
    const turns = liveTurns([user("u1", "Meu chamado?"), listReply, user("u2", ticketChoiceText(notebook))], "submitted");
    expect(turns[1]).toMatchObject({ offer: { kind: "tickets", chosen: "INC-20311", open: false } });
  });

  it("writes the choice as the design shows it", () => {
    expect(ticketChoiceText(notebook)).toBe("INC-20311 · Notebook lento após atualização do Windows");
  });

  it("draws the card of the ticket where it came, before the text, with the replies in the last bubble", () => {
    const turn = liveTurns([user("u1", "INC-20311"), ticketReply], "ready").at(-1);
    expect(turn).toMatchObject({
      blocks: [
        { kind: "ticket", key: "c2", ticket: card },
        { kind: "text", text: "Está sem atualização há 6 dias. Quer que eu chame um analista?" },
      ],
      offer: { kind: "replies", options: replies, chosen: null, open: true },
    });
  });

  it("marks the reply the next message chose, whatever its case, or what started with it", () => {
    const chosen = (next: string) =>
      (liveTurns([user("u1", "INC-20311"), ticketReply, user("u2", next)], "submitted")[1] as { offer: { chosen: string | null } })
        .offer.chosen;
    expect(chosen("Falar com um analista")).toBe("Falar com um analista");
    expect(chosen("não, obrigado")).toBe("Não, obrigado");
    expect(chosen("Adicionar informação. Reiniciei duas vezes.")).toBe("Adicionar informação");
    expect(chosen("Falar com um analistas")).toBeNull();
    expect(chosen("Quero outra coisa")).toBeNull();
  });

  it("has no card for a ticket that was not found, and no offer while it is still being written", () => {
    const turn = liveTurns(
      [
        user("u1", "INC-99999"),
        agent([
          tool("getTicket", "c2", { ticketId: "INC-99999" }, { ok: false, reason: "not_found", message: "?" }),
          { type: "tool-offerReplies", toolCallId: "c3", state: "input-streaming", input: { options: ["Fal"] } } as Part,
        ]),
      ],
      "streaming",
    ).at(-1);
    expect(turn).toMatchObject({ blocks: [], offer: null });
  });

  it("keeps the text on both sides of a card in two bubbles, in order", () => {
    const turn = liveTurns(
      [user("u1", "INC-20311"), agent([text("Vou consultar."), tool("getTicket", "c2", { ticketId: "INC-20311" }, { ok: true, ticket: card }), text("Está vencido.")])],
      "ready",
    ).at(-1);
    expect(turn).toMatchObject({
      blocks: [
        { kind: "text", text: "Vou consultar." },
        { kind: "ticket" },
        { kind: "text", text: "Está vencido." },
      ],
    });
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
