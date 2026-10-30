import { describe, expect, it } from "vitest";
import { canReopen, REOPEN_WINDOW_DAYS } from "./reopen";

// Times in São Paulo (UTC-3): 13:00Z is 10:00 there, 02:59Z is 23:59 of the day before.
const resolved = new Date("2026-10-19T13:00:00Z"); // Monday 19, 10:00 in São Paulo

describe("canReopen", () => {
  it("is 7 calendar days, not business days", () => {
    expect(REOPEN_WINDOW_DAYS).toBe(7);
  });

  it("reopens a ticket resolved 4 and 6 days ago", () => {
    expect(canReopen(resolved, new Date("2026-10-23T13:00:00Z"))).toBe(true);
    expect(canReopen(resolved, new Date("2026-10-25T13:00:00Z"))).toBe(true);
  });

  it("counts the seventh day whole, until midnight in São Paulo", () => {
    expect(canReopen(resolved, new Date("2026-10-26T13:00:00Z"))).toBe(true);
    // Monday 26, 23:59 in São Paulo.
    expect(canReopen(resolved, new Date("2026-10-27T02:59:00Z"))).toBe(true);
  });

  it("refuses from the eighth day on", () => {
    // Tuesday 27, 00:00 in São Paulo.
    expect(canReopen(resolved, new Date("2026-10-27T03:00:00Z"))).toBe(false);
    expect(canReopen(resolved, new Date("2026-10-28T13:00:00Z"))).toBe(false);
  });

  it("counts days in São Paulo, not in UTC", () => {
    // Resolved Sunday 18 at 23:30 in São Paulo, already Monday 19 in UTC: the window ends with Sunday 25.
    const lateSunday = new Date("2026-10-19T02:30:00Z");
    expect(canReopen(lateSunday, new Date("2026-10-26T02:59:00Z"))).toBe(true);
    expect(canReopen(lateSunday, new Date("2026-10-26T03:00:00Z"))).toBe(false);
  });

  it("reopens on the day it was resolved", () => {
    expect(canReopen(resolved, new Date("2026-10-19T14:00:00Z"))).toBe(true);
  });
});
