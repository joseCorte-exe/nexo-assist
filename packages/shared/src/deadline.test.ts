import { describe, expect, it } from "vitest";
import { deadlineWords } from "./deadline";

// Monday 26, 10:00 in São Paulo.
const now = new Date("2026-10-26T13:00:00Z");

describe("deadlineWords", () => {
  it("says the time alone when the deadline is today", () => {
    expect(deadlineWords(new Date("2026-10-26T16:43:00Z"), now)).toBe("hoje, até 13:43");
  });

  it("says tomorrow for the next day in São Paulo", () => {
    expect(deadlineWords(new Date("2026-10-27T13:00:00Z"), now)).toBe("amanhã, até 10:00");
  });

  it("says the day and the month further ahead", () => {
    expect(deadlineWords(new Date("2026-10-29T20:05:00Z"), now)).toBe("até 29 out, 17:05");
  });

  it("uses the day in São Paulo, not in UTC", () => {
    // 01:30Z on Tuesday is still Monday 22:30 in São Paulo.
    expect(deadlineWords(new Date("2026-10-27T01:30:00Z"), now)).toBe("hoje, até 22:30");
  });
});
