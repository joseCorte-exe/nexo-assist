import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, DRAFT_COPY, PRIORITY_LABEL, REJECTION_LABEL, statusText, TICKET_STATUS_LABEL } from "./labels";

describe("labels", () => {
  it("shows each category as the design writes it", () => {
    expect(CATEGORY_LABEL).toEqual({
      access: "Acesso",
      network_vpn: "Rede e VPN",
      hardware: "Hardware",
      software: "Software",
      email: "E-mail",
      other: "Outros",
    });
  });

  it("shows each priority as Annex A writes it", () => {
    expect(PRIORITY_LABEL).toEqual({ critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" });
  });

  it("shows each status as the design writes it", () => {
    expect(TICKET_STATUS_LABEL).toEqual({
      waiting_for_analyst: "Aguardando analista",
      assigned: "Em atendimento",
      in_progress: "Em andamento",
      approved: "Aprovado",
      resolved: "Resolvido",
    });
  });
});

describe("statusText", () => {
  it("says who took a ticket in service", () => {
    expect(statusText("assigned", "Rafael Lima")).toBe("Em atendimento · Assumido por Rafael Lima");
  });

  it("is the plain label otherwise", () => {
    expect(statusText("assigned", null)).toBe("Em atendimento");
    expect(statusText("in_progress", "Juliana Costa")).toBe("Em andamento");
  });
});

describe("the words of a draft", () => {
  it("names each operation as the card and the notes say it", () => {
    expect(DRAFT_COPY.create.named({ number: 381, ticketId: null })).toBe("o rascunho D-381");
    expect(DRAFT_COPY.update.named({ number: 382, ticketId: "INC-20311" })).toBe("o complemento do INC-20311");
    expect(DRAFT_COPY.reopen.named({ number: 383, ticketId: "INC-20150" })).toBe("a reabertura do INC-20150");
  });

  it("says each step of each operation in the words of the card", () => {
    expect(DRAFT_COPY.create).toMatchObject({ kind: "Novo chamado", description: "Descrição", working: "Criando…", done: "Criado", notDone: "Não criado" });
    expect(DRAFT_COPY.update).toMatchObject({ kind: "Complemento", description: "Informação nova", working: "Enviando…", done: "Enviado", notDone: "Não enviado" });
    expect(DRAFT_COPY.reopen).toMatchObject({ kind: "Reabertura", description: "O que aconteceu de novo", working: "Reabrindo…", done: "Reaberto", notDone: "Não reaberto" });
  });

  it("says what the confirmation did", () => {
    expect(DRAFT_COPY.create.confirmed("INC-20320")).toBe("Chamado INC-20320 criado.");
    expect(DRAFT_COPY.update.confirmed("INC-20311")).toBe("Complemento enviado ao INC-20311.");
    expect(DRAFT_COPY.reopen.confirmed("INC-20150")).toBe("INC-20150 reaberto.");
  });

  it("says why the ticket-service refused the confirmation, one sentence for each code", () => {
    expect(REJECTION_LABEL.ticket_not_found(null)).toBe("Não encontrei esse chamado entre os seus.");
    expect(REJECTION_LABEL.ticket_resolved("INC-20311")).toBe("O INC-20311 foi resolvido e não recebe mais complementos.");
    expect(REJECTION_LABEL.ticket_not_resolved("INC-20150")).toBe("O INC-20150 não está mais resolvido.");
    expect(REJECTION_LABEL.reopen_window_closed("INC-19877")).toBe("O INC-19877 foi resolvido há mais de 7 dias e não pode mais ser reaberto.");
  });
});
