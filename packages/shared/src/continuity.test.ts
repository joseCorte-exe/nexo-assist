import { describe, expect, it } from "vitest";
import type { NexoUIMessage } from "./chat";
import { caseAtLimit, limitSummary, pendingAtLimit, reachedLimit } from "./continuity";

// 2026-10-26 is a Monday. Times are São Paulo local (-03:00).
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at("2026-10-26T10:05");

type Parts = NexoUIMessage["parts"];
const text = (value: string): Parts[number] => ({ type: "text", text: value });
const offerReplies = {
  type: "tool-offerReplies",
  toolCallId: "call-offer",
  state: "output-available",
  input: { question: "Quem está sendo afetado?", options: ["Só eu", "Minha equipe"] },
  output: { ok: true },
} as Parts[number];
const ticketChoice = {
  type: "tool-offerTicketChoice",
  toolCallId: "call-choice",
  state: "output-available",
  input: { question: "Sobre qual deles?", ticketIds: ["INC-20311", "INC-20298"] },
  output: { ok: true, tickets: [] },
} as Parts[number];
const refusedChoice = { ...ticketChoice, output: { ok: false, message: "Serviço fora do ar." } } as Parts[number];
const lookedUp = (id: string) =>
  ({ type: "tool-getTicket", toolCallId: `call-${id}`, state: "output-available", input: { ticketId: id }, output: { ok: true, ticket: { id } } }) as Parts[number];
const notFound = { type: "tool-getTicket", toolCallId: "call-x", state: "output-available", input: { ticketId: "INC-1" }, output: { ok: false, reason: "not_found", message: "Não achei." } } as Parts[number];

const reply = (...parts: Parts) => ({ author: "agent" as const, parts });

describe("pendingAtLimit", () => {
  it("is nothing when the Nexo answered and waits for nothing", () => {
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: reply(text("No Windows 10, reinstale o cliente da VPN.")) })).toBeNull();
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: null })).toBeNull();
  });

  it("is the draft waiting for her confirmation, whatever the reply said", () => {
    expect(pendingAtLimit({ pendingDraft: true, lastMessage: reply(text("Confira antes de eu criar:")) })).toBe("draft");
  });

  it("is her last message, when nothing answered it", () => {
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: { author: "employee", parts: [text("E agora?")] } })).toBe("unanswered");
  });

  it("is a question of the Nexo: quick replies, the list of tickets, or a question in the text", () => {
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: reply(text("Não há chamado aberto sobre isso."), offerReplies) })).toBe("question");
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: reply(ticketChoice) })).toBe("question");
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: reply(text("Desde quando o notebook está lento? ")) })).toBe("question");
  });

  it("is not a list that could not be shown, nor a question in the middle of the text", () => {
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: reply(text("Não consegui ver seus chamados agora."), refusedChoice) })).toBeNull();
    expect(pendingAtLimit({ pendingDraft: false, lastMessage: reply(text("Quer saber como? Reinstale o cliente da VPN.")) })).toBeNull();
  });
});

describe("caseAtLimit", () => {
  const classified = { ticketId: null, impact: "stopped" as const, urgency: "same_day" as const, affected: "only_me" as const };

  it("reads the ticket of a follow-up or reopening draft before anything the reply looked up", () => {
    const draft = { ticketId: "INC-20311", impact: null, urgency: null, affected: "only_me" as const };
    expect(caseAtLimit({ draft, lastReply: [lookedUp("INC-20298")] })).toEqual({ ticketId: "INC-20311", classification: null });
  });

  it("reads the classification of a new ticket's draft, the RN-01 of the case", () => {
    expect(caseAtLimit({ draft: classified, lastReply: [] })).toEqual({
      ticketId: null,
      classification: { impact: "stopped", urgency: "same_day", affected: "only_me" },
    });
  });

  it("without a draft, takes the last ticket the reply looked up, and only one it found", () => {
    expect(caseAtLimit({ draft: null, lastReply: [lookedUp("INC-20298"), lookedUp("INC-20311"), notFound] })).toEqual({
      ticketId: "INC-20311",
      classification: null,
    });
    expect(caseAtLimit({ draft: null, lastReply: [notFound] })).toEqual({ ticketId: null, classification: null });
  });
});

describe("reachedLimit", () => {
  it("counts from the 30th message of hers", () => {
    expect(reachedLimit(29)).toBe(false);
    expect(reachedLimit(30)).toBe(true);
    expect(reachedLimit(31)).toBe(true);
  });
});

describe("limitSummary", () => {
  it("says why it came and the case the agent kept", () => {
    expect(
      limitSummary({
        pending: "draft",
        draftTitle: "Notebook lento",
        caseLines: ["Problema: notebook lento desde a atualização.", "Equipamento e sistema: Dell, Windows 11.", "Situação: espera o analista."],
      }),
    ).toBe(
      'A conversa chegou ao limite de 30 mensagens com o rascunho "Notebook lento" esperando confirmação. ' +
        "Problema: notebook lento desde a atualização. Equipamento e sistema: Dell, Windows 11. Situação: espera o analista.",
    );
  });

  it("names the question or the message left without an answer", () => {
    expect(limitSummary({ pending: "question", draftTitle: null, caseLines: [] })).toBe(
      "A conversa chegou ao limite de 30 mensagens com uma pergunta do Nexo sem resposta. Leia a conversa para o contexto.",
    );
    expect(limitSummary({ pending: "unanswered", draftTitle: null, caseLines: [] })).toBe(
      "A conversa chegou ao limite de 30 mensagens com a última mensagem do funcionário sem resposta. Leia a conversa para o contexto.",
    );
  });

  it("fits the 600 characters of a transfer summary", () => {
    const summary = limitSummary({ pending: "question", draftTitle: null, caseLines: [`Problema: ${"lento ".repeat(200)}.`] });
    expect(summary.length).toBe(600);
    expect(summary.endsWith("…")).toBe(true);
  });
});
