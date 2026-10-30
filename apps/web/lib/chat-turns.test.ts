import type { DraftView, NexoUIMessage, TicketCard, TicketSummary } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { type AgentTurn, currentDraft, lastDraftId, liveTurns, messageCount, ticketChoiceText, type Turn } from "./chat-turns";

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
      { kind: "agent", id: "u1-reply", text: "", decision: null, steps: [], blocks: [], phase: "thinking" },
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

const question = "Você tem 2 chamados abertos. Sobre qual deles quer saber?";
const listReply = agent([
  recordDecision("output-available"),
  tool("listMyTickets", "c2", { scope: "open" }, { ok: true, tickets: [notebook, sharepoint] }),
  tool("offerTicketChoice", "c3", { question, ticketIds: ["INC-20311", "INC-20298"] }, { ok: true, tickets: [notebook, sharepoint] }),
]);
const offer = "Está sem atualização há 6 dias. Quer que eu chame um analista?";
const ticketReply = agent([
  recordDecision("output-available"),
  tool("getTicket", "c2", { ticketId: "INC-20311" }, { ok: true, ticket: card }),
  tool("offerReplies", "c3", { question: offer, options: replies }, { ok: true }),
]);

/** What the reply at that position draws, in order. */
const blocksOf = (turns: Turn[], index = turns.length - 1) => (turns[index] as AgentTurn).blocks;

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

  it("asks with the question of the list in a bubble, then the list, open while nobody chose", () => {
    expect(blocksOf(liveTurns([user("u1", "Meu chamado?"), listReply], "ready"))).toEqual([
      { kind: "text", key: "question-c3", text: question },
      { kind: "choice", key: "c3", tickets: [notebook, sharepoint], chosen: null, mode: "open" },
    ]);
  });

  it("keeps the list without clicks while the agent is still answering", () => {
    expect(blocksOf(liveTurns([user("u1", "Meu chamado?"), listReply], "streaming")).at(-1)).toMatchObject({ mode: "busy" });
  });

  it("does not ask twice when the text already has the question", () => {
    const parts = listReply.parts;
    const both = agent([...parts.slice(0, 2), text(`Vi seus chamados. ${question}`), parts[2]!]);
    expect(blocksOf(liveTurns([user("u1", "Meu chamado?"), both], "ready"))).toMatchObject([
      { kind: "text", text: `Vi seus chamados. ${question}` },
      { kind: "choice" },
    ]);
  });

  it("marks the ticket the next message chose, and closes the list", () => {
    const turns = liveTurns([user("u1", "Meu chamado?"), listReply, user("u2", ticketChoiceText(notebook))], "submitted");
    expect(blocksOf(turns, 1).at(-1)).toMatchObject({ kind: "choice", chosen: "INC-20311", mode: "answered" });
  });

  it("writes the choice as the design shows it", () => {
    expect(ticketChoiceText(notebook)).toBe("INC-20311 · Notebook lento após atualização do Windows");
  });

  it("draws the card of the ticket where it came, then the question as a bubble with its replies", () => {
    expect(blocksOf(liveTurns([user("u1", "INC-20311"), ticketReply], "ready"))).toEqual([
      { kind: "ticket", key: "c2", ticket: card },
      { kind: "text", key: "question-c3", text: offer, replies: { question: null, options: replies, chosen: null, mode: "open" } },
    ]);
  });

  it("puts the replies in the last bubble, their question in bold unless the text already says it", () => {
    const parts = ticketReply.parts;
    const apart = blocksOf(liveTurns([user("u1", "INC-20311"), agent([...parts.slice(0, 2), text("Vi o chamado."), parts[2]!])], "ready"));
    expect(apart).toMatchObject([{ kind: "ticket" }, { kind: "text", text: "Vi o chamado.", replies: { question: offer } }]);
    const said = blocksOf(liveTurns([user("u1", "INC-20311"), agent([...parts.slice(0, 2), text(offer), parts[2]!])], "ready"));
    expect(said).toMatchObject([{ kind: "ticket" }, { kind: "text", text: offer, replies: { question: null } }]);
  });

  it("marks the reply the next message chose, whatever its case, or what started with it", () => {
    const chosen = (next: string) => {
      const last = blocksOf(liveTurns([user("u1", "INC-20311"), ticketReply, user("u2", next)], "submitted"), 1).at(-1);
      return last?.kind === "text" ? last.replies?.chosen : undefined;
    };
    expect(chosen("Falar com um analista")).toBe("Falar com um analista");
    expect(chosen("não, obrigado")).toBe("Não, obrigado");
    expect(chosen("Adicionar informação. Reiniciei duas vezes.")).toBe("Adicionar informação");
    expect(chosen("Falar com um analistas")).toBeNull();
    expect(chosen("Quero outra coisa")).toBeNull();
  });

  it("has no card for a ticket that was not found, and no offer while it is still being written", () => {
    const turns = liveTurns(
      [
        user("u1", "INC-99999"),
        agent([
          tool("getTicket", "c2", { ticketId: "INC-99999" }, { ok: false, reason: "not_found", message: "?" }),
          { type: "tool-offerReplies", toolCallId: "c3", state: "input-streaming", input: { question: "Quer", options: ["Fal"] } } as Part,
        ]),
      ],
      "streaming",
    );
    expect(blocksOf(turns)).toEqual([]);
  });

  it("shows no replies when the offer failed, so the agent's explanation is all there is", () => {
    const failed = {
      type: "tool-offerReplies",
      toolCallId: "c3",
      state: "output-error",
      input: { question: offer, options: replies },
      errorText: "invalid",
    } as Part;
    const turns = liveTurns([user("u1", "INC-20311"), agent([failed, text("Não consegui mostrar as opções.")])], "ready");
    expect(blocksOf(turns)).toEqual([{ kind: "text", key: "text-1", text: "Não consegui mostrar as opções." }]);
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

const draft: DraftView = {
  id: "draft-1",
  number: 381,
  operation: "create",
  status: "pending",
  ticketId: null,
  type: "INC",
  title: "VPN não conecta no notebook — erro 809",
  description: "Desde ontem o notebook não conecta na VPN.",
  category: "network_vpn",
  subcategory: "VPN",
  priority: "high",
  affected: "only_me",
  rejectedReason: null,
  deadline: "4 horas úteis",
  dueAt: "2026-10-26T16:43:00.000Z",
  createdAt: "2026-10-26T12:43:00.000Z",
};
const vpnDraftInput = { operation: "create", title: draft.title, description: draft.description };
const aboveTheCard = "Coloquei prioridade alta por causa da reunião. Confira antes de eu criar:";

describe("liveTurns, opening a ticket (feature 4)", () => {
  const steps = (output?: unknown, input: unknown = vpnDraftInput, state?: string) =>
    (
      liveTurns(
        [user("u1", "Só eu"), agent([{ ...tool("draftTicket", "c2", input, output), ...(state ? { state } : {}) } as Part])],
        "streaming",
      ).at(-1) as { steps: unknown }
    ).steps;

  it("says what the code did for a new ticket, as the design writes it", () => {
    expect(steps()).toEqual([{ key: "c2", label: "montando o rascunho", state: "running" }]);
    expect(steps({ ok: true, draft, dueText: "hoje, até 13:43" })).toEqual([
      { key: "c2-priority", label: "classificou a prioridade", state: "done" },
      { key: "c2-sla", label: "consultou o SLA", state: "done" },
      { key: "c2", label: "montou o rascunho", state: "done" },
    ]);
  });

  it("says what it did for a follow-up and for a reopening", () => {
    const followUp = { ...draft, operation: "update", ticketId: "INC-20311" };
    expect(steps({ ok: true, draft: followUp, dueText: "prazo vencido" }, { operation: "update", ticketId: "INC-20311" })).toEqual([
      { key: "c2", label: "montou o complemento do INC-20311", state: "done" },
    ]);
    const reopening = { ...draft, operation: "reopen", ticketId: "INC-20150" };
    expect(steps({ ok: true, draft: reopening, dueText: "até 29 out, 10:00" }, { operation: "reopen", ticketId: "INC-20150" })).toEqual([
      { key: "c2-window", label: "conferiu o prazo de 7 dias", state: "done" },
      { key: "c2", label: "montou a reabertura do INC-20150", state: "done" },
    ]);
  });

  it("names the open ticket it found as possibly the same problem, which is not a failure", () => {
    expect(steps({ ok: false, reason: "possible_duplicate", message: "?", candidates: [notebook] })).toEqual([
      { key: "c2", label: "encontrou um chamado parecido", state: "done" },
    ]);
  });

  it("marks a draft the service did not allow, and shows nothing for an input the model fixes on its own", () => {
    expect(steps({ ok: false, reason: "unavailable", message: "?" })).toEqual([
      { key: "c2", label: "não montou o rascunho", state: "failed" },
    ]);
    expect(steps({ error: true, message: "Para criar, falta title." })).toEqual([]);
    expect(steps(undefined, vpnDraftInput, "output-error")).toEqual([]);
  });

  it("draws the card at the end of the reply, under the text that introduces it", () => {
    const reply = agent([recordDecision("output-available"), tool("draftTicket", "c2", vpnDraftInput, { ok: true, draft, dueText: "hoje" }), text(aboveTheCard)]);
    expect(blocksOf(liveTurns([user("u1", "Só eu"), reply], "ready"))).toEqual([
      { kind: "text", key: "text-2", text: aboveTheCard },
      { kind: "draft", key: "c2", draft },
    ]);
  });

  it("draws only the last draft when the model drafted twice in one reply", () => {
    const update = { ...draft, id: "draft-2", operation: "update" as const, ticketId: "INC-20311" };
    const reply = agent([
      tool("draftTicket", "c2", vpnDraftInput, { ok: false, reason: "possible_duplicate", message: "?", candidates: [notebook] }),
      tool("draftTicket", "c3", { operation: "update", ticketId: "INC-20311" }, { ok: true, draft: update, dueText: "prazo vencido" }),
      text("Já existe o INC-20311."),
    ]);
    expect(blocksOf(liveTurns([user("u1", "Só eu"), reply], "ready"))).toEqual([
      { kind: "text", key: "text-2", text: "Já existe o INC-20311." },
      { kind: "draft", key: "c3", draft: update },
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

describe("currentDraft", () => {
  const first = { ...draft, id: "draft-1" };
  const second = { ...draft, id: "draft-2", number: 382 };

  it("is the draft as last known, from the server or from an action of the card", () => {
    const known = { "draft-1": { ...first, status: "confirmed" as const, ticketId: "INC-20320" } };
    expect(currentDraft(first, known, "draft-1")).toMatchObject({ status: "confirmed", ticketId: "INC-20320" });
  });

  it("is the draft the agent showed when nothing newer is known", () => {
    expect(currentDraft(first, {}, "draft-1")).toEqual(first);
  });

  it("reads a pending draft that is not the last of the conversation as superseded, as the server keeps it", () => {
    expect(currentDraft(first, {}, "draft-2")).toMatchObject({ status: "superseded" });
    expect(currentDraft(second, {}, "draft-2")).toMatchObject({ status: "pending" });
  });
});

describe("lastDraftId", () => {
  it("is the id of the last draft shown in the conversation", () => {
    const reply = (id: string, toolCallId: string) =>
      agent([tool("draftTicket", toolCallId, vpnDraftInput, { ok: true, draft: { ...draft, id }, dueText: "hoje" })]);
    expect(lastDraftId([user("u1", "a"), reply("draft-1", "c1"), user("u2", "b"), reply("draft-2", "c2")])).toBe("draft-2");
    expect(lastDraftId([user("u1", "a")])).toBeNull();
  });
});
