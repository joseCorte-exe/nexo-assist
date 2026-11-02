import { describe, expect, it } from "vitest";
import { transferToAnalystInput } from "./chat";
import { LEVEL_LABEL, routeTransfer } from "./transfer";

// 2026-10-26 is a Monday. Times are São Paulo local (-03:00).
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at("2026-10-26T10:05");

const ticket = (priority: "critical" | "high" | "medium" | "low", dueAt: Date, status: "waiting_for_analyst" | "resolved" = "waiting_for_analyst") => ({
  priority,
  status,
  dueAt,
});

describe("routeTransfer", () => {
  it("sends a critical ticket to N2, even when the employee only asked", () => {
    const route = routeTransfer({ requested: "employee_request", ticket: ticket("critical", at("2026-10-26T11:00")), classification: null, at: NOW });
    expect(route).toMatchObject({ level: "N2", reason: "critical", priority: "critical" });
  });

  it("sends an overdue ticket to N2, even when the employee only asked", () => {
    const route = routeTransfer({ requested: "employee_request", ticket: ticket("medium", at("2026-10-23T10:00")), classification: null, at: NOW });
    expect(route).toMatchObject({ level: "N2", reason: "overdue", priority: "medium" });
  });

  it("names a ticket that is critical and overdue critical: the more severe reason", () => {
    const route = routeTransfer({ requested: "agent_unsure", ticket: ticket("critical", at("2026-10-26T09:00")), classification: null, at: NOW });
    expect(route).toMatchObject({ level: "N2", reason: "critical" });
  });

  it("does not take a resolved ticket past its deadline for an overdue one", () => {
    const route = routeTransfer({ requested: "employee_request", ticket: ticket("medium", at("2026-10-23T10:00"), "resolved"), classification: null, at: NOW });
    expect(route).toMatchObject({ level: "N1", reason: "employee_request" });
  });

  it("sends the employee's request to N1", () => {
    const route = routeTransfer({ requested: "employee_request", ticket: ticket("high", at("2026-10-26T14:05")), classification: null, at: NOW });
    expect(route).toMatchObject({ level: "N1", reason: "employee_request", priority: "high" });
  });

  it("sends the agent's doubt to N1", () => {
    const route = routeTransfer({ requested: "agent_unsure", ticket: null, classification: null, at: NOW });
    expect(route).toMatchObject({ level: "N1", reason: "agent_unsure" });
  });

  it("reads the priority of a case without a ticket from what the model classified (RN-01)", () => {
    const stopped = { impact: "stopped", urgency: "none", affected: "my_team" } as const;
    const route = routeTransfer({ requested: "employee_request", ticket: null, classification: stopped, at: NOW });
    expect(route).toMatchObject({ level: "N2", reason: "critical", priority: "critical" });
  });

  it("prefers the ticket over the classification: the model never overrides what the service says", () => {
    const stopped = { impact: "stopped", urgency: "none", affected: "company" } as const;
    const route = routeTransfer({ requested: "employee_request", ticket: ticket("low", at("2026-11-02T10:05")), classification: stopped, at: NOW });
    expect(route).toMatchObject({ level: "N1", priority: "low" });
  });

  it("counts a case without ticket or classification as medium", () => {
    const route = routeTransfer({ requested: "employee_request", ticket: null, classification: null, at: NOW });
    expect(route.priority).toBe("medium");
  });

  it("waits the deadline of the priority, counted from the transfer", () => {
    const high = routeTransfer({ requested: "employee_request", ticket: ticket("high", at("2026-10-26T14:05")), classification: null, at: NOW });
    expect(high.waitUntil).toEqual(at("2026-10-26T14:05"));
    const critical = routeTransfer({ requested: "employee_request", ticket: ticket("critical", at("2026-10-26T11:00")), classification: null, at: NOW });
    expect(critical.waitUntil).toEqual(at("2026-10-26T11:05"));
    const medium = routeTransfer({ requested: "agent_unsure", ticket: null, classification: null, at: NOW });
    expect(medium.waitUntil).toEqual(at("2026-10-29T10:05"));
  });
});

describe("LEVEL_LABEL", () => {
  it("names each level as the design does", () => {
    expect(LEVEL_LABEL.N1).toBe("Suporte N1");
    expect(LEVEL_LABEL.N2).toBe("Suporte N2");
  });
});

describe("transferToAnalystInput", () => {
  const summary = "Notebook lento há 6 dias desde a atualização do Windows; o INC-20311 está vencido.";

  it("takes the reason, the summary and the ticket", () => {
    const input = transferToAnalystInput.parse({ reason: "employee_request", summary, ticketId: "inc-20311" });
    expect(input).toEqual({ reason: "employee_request", summary, ticketId: "INC-20311" });
  });

  it("refuses a summary too short to spare the analyst the questions", () => {
    expect(transferToAnalystInput.safeParse({ reason: "employee_request", summary: "Quer analista." }).success).toBe(false);
  });

  it("takes the classification only whole", () => {
    const whole = { reason: "employee_request", summary, impact: "stopped", urgency: "none", affected: "company" };
    expect(transferToAnalystInput.safeParse(whole).success).toBe(true);
    const parsed = transferToAnalystInput.safeParse({ reason: "employee_request", summary, impact: "stopped" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toMatch(/impact, urgency e affected/);
  });

  it("refuses the reasons only the code decides", () => {
    expect(transferToAnalystInput.safeParse({ reason: "critical", summary }).success).toBe(false);
    expect(transferToAnalystInput.safeParse({ reason: "overdue", summary }).success).toBe(false);
  });
});
