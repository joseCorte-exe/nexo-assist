import { describe, expect, it } from "vitest";
import { changeRefusal, isReopenable, REOPEN_WINDOW_DAYS, reopenedDueAt } from "./ticket-change";

// Times in São Paulo (UTC-3): 13:00Z is 10:00 there, 02:59Z is 23:59 of the day before.
const resolvedAt = new Date("2026-10-19T13:00:00Z"); // Monday 19, 10:00 in São Paulo
const resolved = { status: "resolved" as const, resolvedAt };
const open = { status: "waiting_for_analyst" as const, resolvedAt: null };

describe("isReopenable", () => {
  it("is 7 calendar days, not business days", () => {
    expect(REOPEN_WINDOW_DAYS).toBe(7);
  });

  it("reopens a ticket resolved 4 and 6 days ago", () => {
    expect(isReopenable(resolved, new Date("2026-10-23T13:00:00Z"))).toBe(true);
    expect(isReopenable(resolved, new Date("2026-10-25T13:00:00Z"))).toBe(true);
  });

  it("counts the seventh day whole, until midnight in São Paulo", () => {
    expect(isReopenable(resolved, new Date("2026-10-26T13:00:00Z"))).toBe(true);
    // Monday 26, 23:59 in São Paulo.
    expect(isReopenable(resolved, new Date("2026-10-27T02:59:00Z"))).toBe(true);
  });

  it("refuses from the eighth day on", () => {
    // Tuesday 27, 00:00 in São Paulo.
    expect(isReopenable(resolved, new Date("2026-10-27T03:00:00Z"))).toBe(false);
    expect(isReopenable(resolved, new Date("2026-10-28T13:00:00Z"))).toBe(false);
  });

  it("counts days in São Paulo, not in UTC", () => {
    // Resolved Sunday 18 at 23:30 in São Paulo, already Monday 19 in UTC: the window ends with Sunday 25.
    const lateSunday = { status: "resolved" as const, resolvedAt: new Date("2026-10-19T02:30:00Z") };
    expect(isReopenable(lateSunday, new Date("2026-10-26T02:59:00Z"))).toBe(true);
    expect(isReopenable(lateSunday, new Date("2026-10-26T03:00:00Z"))).toBe(false);
  });

  it("reopens on the day it was resolved", () => {
    expect(isReopenable(resolved, new Date("2026-10-19T14:00:00Z"))).toBe(true);
  });

  it("never reopens a ticket that is not resolved", () => {
    expect(isReopenable(open, new Date("2026-10-19T14:00:00Z"))).toBe(false);
  });

  it("takes the ticket as the service stores it or as it travels, with the date as text", () => {
    const sent = { status: "resolved" as const, resolvedAt: "2026-10-19T13:00:00.000Z" };
    expect(isReopenable(sent, new Date("2026-10-23T13:00:00Z"))).toBe(true);
    expect(isReopenable(sent, new Date("2026-10-28T13:00:00Z"))).toBe(false);
  });
});

describe("changeRefusal", () => {
  const now = new Date("2026-10-23T13:00:00Z");

  it("lets an open ticket get a follow-up and a resolved one in the window be reopened", () => {
    expect(changeRefusal("update", open, now)).toBeNull();
    expect(changeRefusal("reopen", resolved, now)).toBeNull();
  });

  it("refuses a follow-up on a resolved ticket: it is reopened instead", () => {
    expect(changeRefusal("update", resolved, now)).toBe("ticket_resolved");
  });

  it("refuses to reopen a ticket that is not resolved", () => {
    expect(changeRefusal("reopen", open, now)).toBe("ticket_not_resolved");
  });

  it("refuses to reopen past the 7 days", () => {
    expect(changeRefusal("reopen", resolved, new Date("2026-10-28T13:00:00Z"))).toBe("reopen_window_closed");
  });
});

describe("reopenedDueAt", () => {
  it("counts the deadline from the reopening, as a new opening", () => {
    const ticket = {
      priority: "high" as const,
      createdAt: new Date("2026-10-12T13:00:00Z"),
      lastItResponseAt: new Date("2026-10-13T13:00:00Z"),
    };
    // Reopened Friday 23 at 10:00 in São Paulo: 4 business hours, 14:00.
    expect(reopenedDueAt(ticket, new Date("2026-10-23T13:00:00Z"))).toEqual(new Date("2026-10-23T17:00:00Z"));
  });

  it("takes the dates as text too", () => {
    const ticket = { priority: "high" as const, createdAt: "2026-10-12T13:00:00.000Z", lastItResponseAt: null };
    expect(reopenedDueAt(ticket, new Date("2026-10-23T13:00:00Z"))).toEqual(new Date("2026-10-23T17:00:00Z"));
  });
});
