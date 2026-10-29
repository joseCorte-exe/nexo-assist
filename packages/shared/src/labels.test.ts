import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, PRIORITY_LABEL, statusText, TICKET_STATUS_LABEL } from "./labels";

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
