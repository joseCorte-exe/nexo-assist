import { describe, expect, it } from "vitest";
import { firstName, formatConfidence, formatDuration, formatPasswordAge, formatPercent, initials } from "./format";

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

describe("formatConfidence", () => {
  it("names the level and keeps the number, from 0 to 1 as the agent records it", () => {
    expect(formatConfidence(0.86)).toEqual({ level: "high", text: "Alta · 86%" });
    expect(formatConfidence(0.8)).toEqual({ level: "high", text: "Alta · 80%" });
    expect(formatConfidence(0.68)).toEqual({ level: "medium", text: "Média · 68%" });
    expect(formatConfidence(0.6)).toEqual({ level: "medium", text: "Média · 60%" });
  });

  it("calls low what is under 0.6, the line of ARQUITETURA.md for an unsure agent", () => {
    expect(formatConfidence(0.41)).toEqual({ level: "low", text: "Baixa · 41%" });
    // Rounded down, so a low confidence never reads as 60%.
    expect(formatConfidence(0.599)).toEqual({ level: "low", text: "Baixa · 59%" });
  });

  it("says when the reduced record has no confidence", () => {
    expect(formatConfidence(null)).toEqual({ level: "none", text: "Não registrada" });
  });
});

describe("firstName", () => {
  it("greets by the first name", () => {
    expect(firstName("Ana Souza")).toBe("Ana");
    expect(firstName("  Fábio  Nunes ")).toBe("Fábio");
  });
});
