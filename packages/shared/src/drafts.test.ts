import { describe, expect, it } from "vitest";
import { draftLabel, draftTicketInput, draftTicketOutput, draftView, editDraftInput } from "./drafts";
import { nexoToolSchemas } from "./chat";

const create = {
  operation: "create",
  title: "VPN não conecta no notebook — erro 809",
  description: "Desde 20/10 o notebook (Windows 11) não conecta na VPN e mostra o erro 809. Precisa dela para a reunião das 14h.",
  category: "network_vpn",
  subcategory: "VPN",
  impact: "stopped",
  urgency: "same_day",
  affected: "only_me",
};

/** The messages of a refused input, which the model reads to fix its call. */
const problems = (input: unknown) => {
  const parsed = draftTicketInput.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("draftTicketInput", () => {
  it("takes a new ticket whole", () => {
    expect(draftTicketInput.parse(create)).toEqual(create);
  });

  it("says what a new ticket is missing, in words the model can act on", () => {
    expect(problems({ operation: "create", description: create.description })).toEqual([
      "Para criar, falta title.",
      "Para criar, falta category.",
      "Para criar, falta impact.",
      "Para criar, falta urgency.",
      "Para criar, falta affected.",
    ]);
  });

  it("asks for a description an analyst can work from, not a few words", () => {
    expect(problems({ ...create, description: "VPN não vai" })).toEqual([
      "Para criar, a description precisa contar o que acontece, desde quando e em qual equipamento ou sistema.",
    ]);
  });

  it("never takes a ticket number when creating", () => {
    expect(problems({ ...create, ticketId: "INC-20311" })).toEqual(["Para criar, não mande ticketId."]);
  });

  it("takes a follow-up: the ticket and the new information only", () => {
    const update = { operation: "update", ticketId: "inc-20311", description: "Agora também trava ao abrir o Teams." };
    expect(draftTicketInput.parse(update)).toEqual({ ...update, ticketId: "INC-20311" });
    expect(draftTicketInput.parse({ ...update, operation: "reopen" }).operation).toBe("reopen");
  });

  it("needs the ticket for a follow-up or a reopening, and nothing of a new ticket", () => {
    expect(problems({ operation: "update", description: "Mais um detalhe." })).toEqual(["Para update, falta ticketId."]);
    expect(problems({ operation: "reopen", ticketId: "INC-20150", description: "Bloqueou de novo.", category: "access" })).toEqual([
      "Em reopen, mande só ticketId e description: a classificação é a do chamado.",
    ]);
  });

  it("keeps the title and the description within what the card shows", () => {
    expect(draftTicketInput.safeParse({ ...create, title: "t".repeat(91) }).success).toBe(false);
    expect(draftTicketInput.safeParse({ ...create, description: "d".repeat(1001) }).success).toBe(false);
  });

  it("is the input of the draftTicket tool", () => {
    expect(nexoToolSchemas.draftTicket.inputSchema).toBe(draftTicketInput);
    expect(nexoToolSchemas.draftTicket.outputSchema).toBe(draftTicketOutput);
  });
});

const view = {
  id: "draft-1",
  number: 381,
  operation: "create",
  status: "pending",
  ticketId: null,
  type: "INC",
  title: create.title,
  description: create.description,
  category: "network_vpn",
  subcategory: "VPN",
  priority: "high",
  affected: "only_me",
  rejectedReason: null,
  deadline: "4 horas úteis",
  dueAt: "2026-10-26T16:43:00.000Z",
  createdAt: "2026-10-26T12:43:00.000Z",
};

describe("draftTicketOutput", () => {
  it("brings the draft and its deadline in words for the model", () => {
    const output = { ok: true, draft: view, dueText: "hoje, até 13:43" };
    expect(draftTicketOutput.parse(output)).toEqual(output);
  });

  it("brings the open tickets that look like the same problem", () => {
    const output = {
      ok: false,
      reason: "possible_duplicate",
      message: "Há um chamado aberto parecido.",
      candidates: [{ id: "INC-20311", title: "Notebook lento", status: "waiting_for_analyst", createdAt: view.createdAt, overdue: true }],
    };
    expect(draftTicketOutput.parse(output)).toEqual(output);
  });

  it("says why a follow-up or a reopening could not be drafted", () => {
    for (const reason of ["not_found", "resolved", "not_resolved", "reopen_window_closed", "unavailable"]) {
      expect(draftTicketOutput.safeParse({ ok: false, reason, message: "Não deu." }).success).toBe(true);
    }
  });
});

describe("draftView", () => {
  it("is a draft as the card draws it, in any of its states", () => {
    for (const status of ["pending", "confirmed", "cancelled", "superseded"]) {
      expect(draftView.safeParse({ ...view, status }).success).toBe(true);
    }
  });

  it("says why the ticket-service refused a confirmation", () => {
    for (const rejectedReason of ["ticket_not_found", "ticket_resolved", "ticket_not_resolved", "reopen_window_closed"]) {
      expect(draftView.safeParse({ ...view, status: "rejected", rejectedReason }).success).toBe(true);
    }
  });

  it("names a draft the way the design does", () => {
    expect(draftLabel(381)).toBe("D-381");
  });
});

describe("editDraftInput", () => {
  it("takes the title, the description and the category, trimmed", () => {
    expect(editDraftInput.parse({ title: "  VPN cai  ", description: " Erro 809. ", category: "network_vpn" })).toEqual({
      title: "VPN cai",
      description: "Erro 809.",
      category: "network_vpn",
    });
  });

  it("never takes the priority, which comes from the rule", () => {
    expect(editDraftInput.parse({ title: "VPN cai", priority: "critical" })).toEqual({ title: "VPN cai" });
  });

  it("asks for something to change, and for fields that are not empty", () => {
    expect(editDraftInput.safeParse({}).error?.issues[0]?.message).toBe("Nada para salvar.");
    expect(editDraftInput.safeParse({ title: "  " }).error?.issues[0]?.message).toBe("Escreva o título.");
    expect(editDraftInput.safeParse({ description: "" }).error?.issues[0]?.message).toBe("Escreva a descrição.");
    expect(editDraftInput.safeParse({ title: "t".repeat(91) }).error?.issues[0]?.message).toBe("O título pode ter até 90 caracteres.");
    expect(editDraftInput.safeParse({ description: "d".repeat(1001) }).error?.issues[0]?.message).toBe(
      "A descrição pode ter até 1.000 caracteres.",
    );
  });
});
