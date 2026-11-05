import { describe, expect, it } from "vitest";
import { findTicketIds, ticketDetailSchema, ticketFollowUpInput, ticketId } from "./tickets";

describe("ticketId", () => {
  it("takes INC or REQ with 5 digits, uppercased and trimmed", () => {
    expect(ticketId.parse("INC-20311")).toBe("INC-20311");
    expect(ticketId.parse(" req-10442 ")).toBe("REQ-10442");
  });

  it("rejects anything else, so a path or query never carries free text", () => {
    for (const bad of ["INC-2031", "INC-203111", "ABC-12345", "INC 20311", "20311", "INC-20311/../x", ""]) {
      expect(ticketId.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("findTicketIds", () => {
  it("finds the ticket numbers in a message, in order and once each", () => {
    expect(findTicketIds("Como está o inc-20311? E o REQ-10442, e de novo o INC-20311")).toEqual([
      "INC-20311",
      "REQ-10442",
    ]);
  });

  it("finds nothing in a message without a number, or inside a longer one", () => {
    expect(findTicketIds("Qual o status do meu chamado?")).toEqual([]);
    expect(findTicketIds("INC-203111 e XINC-20311")).toEqual([]);
  });
});

describe("ticketDetailSchema", () => {
  const detail = {
    id: "REQ-10442",
    type: "REQ",
    title: "Segundo monitor para home office",
    description: "Preciso de um segundo monitor para trabalhar de casa.",
    category: "hardware",
    subcategory: null,
    priority: "low",
    affected: "only_me",
    status: "approved",
    openedBy: "emp-ana",
    assignedTo: "analyst-juliana",
    createdAt: "2026-10-17T13:00:00.000Z",
    updatedAt: "2026-10-19T13:00:00.000Z",
    lastItResponseAt: "2026-10-19T13:00:00.000Z",
    dueAt: "2026-10-26T13:00:00.000Z",
    resolvedAt: null,
  };

  it("is the ticket with the name of who took it and its updates", () => {
    const parsed = ticketDetailSchema.parse({
      ...detail,
      assigneeName: "Juliana Costa",
      updates: [{ author: "analyst", text: "Pedido aprovado pelo gestor.", createdAt: "2026-10-19T13:00:00.000Z" }],
    });
    expect(parsed.assigneeName).toBe("Juliana Costa");
    expect(parsed.updates).toHaveLength(1);
  });

  it("needs a known author on every update", () => {
    const parsed = ticketDetailSchema.safeParse({
      ...detail,
      assigneeName: null,
      updates: [{ author: "robot", text: "?", createdAt: "2026-10-19T13:00:00.000Z" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("ticketFollowUpInput", () => {
  it("takes the employee and the text, trimmed", () => {
    expect(ticketFollowUpInput.parse({ employeeId: "emp-ana", text: "  Trava no Teams também. " })).toEqual({
      employeeId: "emp-ana",
      text: "Trava no Teams também.",
    });
  });

  it("refuses an empty text, a text too long and a missing employee", () => {
    expect(ticketFollowUpInput.safeParse({ employeeId: "emp-ana", text: " " }).success).toBe(false);
    expect(ticketFollowUpInput.safeParse({ employeeId: "emp-ana", text: "x".repeat(2001) }).success).toBe(false);
    expect(ticketFollowUpInput.safeParse({ text: "Oi" }).success).toBe(false);
  });
});
