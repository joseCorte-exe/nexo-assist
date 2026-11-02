import { describe, expect, it } from "vitest";
import type { NexoUIMessage } from "./chat";
import { caseAtLimit, counterText, limitSummary, pendingAtLimit, resumeNote } from "./continuity";

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
  const classified = { operation: "create" as const, ticketId: null, impact: "stopped" as const, urgency: "same_day" as const, affected: "only_me" as const };

  it("reads the ticket of a follow-up or reopening draft before anything the reply looked up", () => {
    const draft = { operation: "update" as const, ticketId: "INC-20311", impact: null, urgency: null, affected: "only_me" as const };
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

describe("limitSummary", () => {
  const notes = `# Caso
- Problema: notebook lento desde a atualização
- Equipamento e sistema: Dell, Windows 11
- O que já foi tentado:
- Situação: espera o analista`;

  it("says why it came and the case the agent kept, without the empty lines of the template", () => {
    expect(limitSummary({ pending: "draft", draftTitle: "Notebook lento", caseNotes: notes })).toBe(
      'A conversa chegou ao limite de 30 mensagens com o rascunho "Notebook lento" esperando confirmação. ' +
        "Problema: notebook lento desde a atualização. Equipamento e sistema: Dell, Windows 11. Situação: espera o analista.",
    );
  });

  it("names the question or the message left without an answer", () => {
    expect(limitSummary({ pending: "question", draftTitle: null, caseNotes: null })).toBe(
      "A conversa chegou ao limite de 30 mensagens com uma pergunta do Nexo sem resposta. Leia a conversa para o contexto.",
    );
    expect(limitSummary({ pending: "unanswered", draftTitle: null, caseNotes: "# Caso\n- Problema:" })).toBe(
      "A conversa chegou ao limite de 30 mensagens com a última mensagem do funcionário sem resposta. Leia a conversa para o contexto.",
    );
  });

  it("fits the 600 characters of a transfer summary", () => {
    const summary = limitSummary({ pending: "question", draftTitle: null, caseNotes: `- Problema: ${"lento ".repeat(200)}` });
    expect(summary.length).toBe(600);
    expect(summary.endsWith("…")).toBe(true);
  });
});

describe("resumeNote", () => {
  it("says nothing on the same São Paulo day, however long the pause", () => {
    expect(resumeNote(at("2026-10-26T00:10"), at("2026-10-26T23:50"))).toBeNull();
    expect(resumeNote(null, NOW)).toBeNull();
  });

  it("tells the agent the conversation comes back on another day, and to look again", () => {
    // 01:00 UTC on the 27th is still the 26th in São Paulo.
    expect(resumeNote(new Date("2026-10-27T01:00:00Z"), at("2026-10-27T09:00"))).toBe(
      "A conversa continua hoje, 27 out, depois de uma pausa: a mensagem anterior é de 26 out. O que as ferramentas disseram antes pode ter mudado; consulte de novo antes de falar da situação de um chamado.",
    );
  });
});

describe("counterText", () => {
  const withAgent = { state: "with_agent" as const, limitReached: false, analystName: null };

  it("counts the conversation until the last five", () => {
    expect(counterText(0, withAgent)).toEqual({ text: "0/30 mensagens nesta sessão", tone: "muted" });
    expect(counterText(24, withAgent)).toEqual({ text: "24/30 mensagens nesta sessão", tone: "muted" });
  });

  it("tells what is left from 25 on, while the Nexo answers", () => {
    expect(counterText(25, withAgent)).toEqual({ text: "Restam 5 mensagens nesta sessão", tone: "warning" });
    expect(counterText(29, withAgent)).toEqual({ text: "Resta 1 mensagem nesta sessão", tone: "warning" });
  });

  it("does not warn while an analyst has her: nothing changes for her at 30", () => {
    expect(counterText(27, { state: "with_analyst", limitReached: false, analystName: "Rafael Lima" })).toEqual({
      text: "27/30 mensagens nesta sessão",
      tone: "muted",
    });
  });

  it("past the limit with an analyst, says who stays instead of counting past 30", () => {
    expect(counterText(31, { state: "with_analyst", limitReached: true, analystName: "Rafael Lima" })).toEqual({
      text: "Limite do Nexo atingido · Rafael Lima continua com você",
      tone: "muted",
    });
    expect(counterText(30, { state: "waiting_for_analyst", limitReached: true, analystName: null })).toEqual({
      text: "Limite do Nexo atingido · um analista continua com você",
      tone: "muted",
    });
  });

  it("a conversation closed by the limit counts 30 of 30", () => {
    expect(counterText(30, { state: "closed", limitReached: true, analystName: null })).toEqual({ text: "30/30 mensagens nesta sessão", tone: "muted" });
  });
});
