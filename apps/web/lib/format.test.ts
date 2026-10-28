import { describe, expect, it } from "vitest";
import { formatDuration, formatPasswordAge, formatPercent, initials } from "./format";

describe("formatDuration", () => {
  it("shows seconds under a minute, as the login screen does", () => {
    expect(formatDuration(8)).toBe("8 s");
    expect(formatDuration(8.4)).toBe("8 s");
    expect(formatDuration(0)).toBe("0 s");
  });

  it("switches to minutes and hours", () => {
    expect(formatDuration(59.6)).toBe("1 min");
    expect(formatDuration(150)).toBe("3 min");
    expect(formatDuration(2 * 3600)).toBe("2 h");
  });

  it("shows a dash when there is no number", () => {
    expect(formatDuration(null)).toBe("–");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(72.4)).toBe("72%");
    expect(formatPercent(null)).toBe("–");
  });
});

describe("formatPasswordAge", () => {
  const now = new Date("2026-10-26T13:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it("counts whole days, as the profile screen does", () => {
    expect(formatPasswordAge(daysAgo(42), now)).toBe("Alterada há 42 dias");
    expect(formatPasswordAge(daysAgo(42.9), now)).toBe("Alterada há 42 dias");
  });

  it("handles today, one day and never", () => {
    expect(formatPasswordAge(daysAgo(0.5), now)).toBe("Alterada hoje");
    expect(formatPasswordAge(daysAgo(1), now)).toBe("Alterada há 1 dia");
    expect(formatPasswordAge(null, now)).toBe("Nunca alterada");
  });
});

describe("initials", () => {
  it("takes the first letter of the first and last names", () => {
    expect(initials("Ana Souza")).toBe("AS");
    expect(initials("Maria da Silva Prado")).toBe("MP");
    expect(initials("  rafael  ")).toBe("R");
  });
});
