import { describe, expect, it } from "vitest";
import { addBusinessHours, dueAt, isOverdue } from "./sla";

// 2026-10-26 is a Monday. Times are São Paulo local (-03:00).
const at = (local: string) => new Date(`${local}-03:00`);

describe("addBusinessHours", () => {
  it("adds within the same day", () => {
    expect(addBusinessHours(at("2026-10-26T10:00"), 4)).toEqual(at("2026-10-26T14:00"));
  });

  it("ends exactly at closing time without rolling to the next day", () => {
    expect(addBusinessHours(at("2026-10-26T14:00"), 4)).toEqual(at("2026-10-26T18:00"));
  });

  it("carries the rest to the next morning", () => {
    expect(addBusinessHours(at("2026-10-26T16:00"), 4)).toEqual(at("2026-10-27T10:00"));
  });

  it("skips the weekend", () => {
    expect(addBusinessHours(at("2026-10-30T17:00"), 4)).toEqual(at("2026-11-02T11:00"));
  });

  it("starts counting at the next opening when started on a weekend", () => {
    expect(addBusinessHours(at("2026-10-31T10:00"), 1)).toEqual(at("2026-11-02T09:00"));
  });

  it("starts counting at 8h when started before opening", () => {
    expect(addBusinessHours(at("2026-10-26T06:00"), 1)).toEqual(at("2026-10-26T09:00"));
  });

  it("starts counting the next morning when started after closing", () => {
    expect(addBusinessHours(at("2026-10-26T19:00"), 1)).toEqual(at("2026-10-27T09:00"));
  });

  it("uses São Paulo time even though the server runs in UTC", () => {
    // 20:00 UTC on Monday is 17:00 in São Paulo: one business hour is left that day.
    expect(addBusinessHours(new Date("2026-10-26T20:00:00Z"), 2)).toEqual(at("2026-10-27T09:00"));
  });
});

describe("RN-02 dueAt", () => {
  const createdAt = at("2026-10-26T10:00");

  it("gives critical 1 hour around the clock", () => {
    expect(dueAt({ priority: "critical", createdAt: at("2026-10-31T03:00"), lastItResponseAt: null })).toEqual(
      at("2026-10-31T04:00"),
    );
  });

  it("gives high 4 business hours", () => {
    expect(dueAt({ priority: "high", createdAt, lastItResponseAt: null })).toEqual(at("2026-10-26T14:00"));
  });

  it("gives medium 3 business days", () => {
    expect(dueAt({ priority: "medium", createdAt, lastItResponseAt: null })).toEqual(at("2026-10-29T10:00"));
  });

  it("gives low 5 business days", () => {
    expect(dueAt({ priority: "low", createdAt, lastItResponseAt: null })).toEqual(at("2026-11-02T10:00"));
  });

  it("restarts from the last IT response", () => {
    expect(dueAt({ priority: "high", createdAt, lastItResponseAt: at("2026-10-27T09:00") })).toEqual(
      at("2026-10-27T13:00"),
    );
  });
});

describe("isOverdue", () => {
  const due = at("2026-10-26T14:00");

  it("is overdue past the deadline when not resolved", () => {
    expect(isOverdue({ status: "waiting_for_analyst", dueAt: due }, at("2026-10-26T14:01"))).toBe(true);
  });

  it("is not overdue at the deadline itself", () => {
    expect(isOverdue({ status: "waiting_for_analyst", dueAt: due }, due)).toBe(false);
  });

  it("is never overdue once resolved", () => {
    expect(isOverdue({ status: "resolved", dueAt: due }, at("2026-11-30T10:00"))).toBe(false);
  });

  it("marks a medium ticket with no IT response for 6 days as overdue (INC-20311)", () => {
    const now = at("2026-10-28T11:00");
    const createdAt = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    const ticket = { status: "waiting_for_analyst" as const, dueAt: dueAt({ priority: "medium", createdAt, lastItResponseAt: null }) };
    expect(isOverdue(ticket, now)).toBe(true);
  });
});
