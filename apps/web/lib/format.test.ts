import { describe, expect, it } from "vitest";
import {
  firstName,
  formatConfidence,
  formatDay,
  formatDayTime,
  formatDuration,
  formatPasswordAge,
  formatPercent,
  formatTimeAgo,
  initials,
} from "./format";

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
    expect(formatConfidence(0.86)).toEqual({ level: "high", text: "Alta · 86%", percent: 86 });
    expect(formatConfidence(0.8)).toEqual({ level: "high", text: "Alta · 80%", percent: 80 });
    expect(formatConfidence(0.68)).toEqual({ level: "medium", text: "Média · 68%", percent: 68 });
    expect(formatConfidence(0.6)).toEqual({ level: "medium", text: "Média · 60%", percent: 60 });
  });

  it("calls low what is under 0.6, the line of ARQUITETURA.md for an unsure agent", () => {
    expect(formatConfidence(0.41)).toEqual({ level: "low", text: "Baixa · 41%", percent: 41 });
    // Rounded down, so a low confidence never reads as 60%.
    expect(formatConfidence(0.599)).toEqual({ level: "low", text: "Baixa · 59%", percent: 59 });
  });
});

describe("firstName", () => {
  it("greets by the first name", () => {
    expect(firstName("Ana Souza")).toBe("Ana");
    expect(firstName("  Fábio  Nunes ")).toBe("Fábio");
  });
});

describe("formatDay and formatDayTime", () => {
  it("shows the day and the month as the design writes them, in São Paulo time", () => {
    // 17:20 UTC is 14:20 in São Paulo.
    expect(formatDay("2026-10-16T17:20:00.000Z")).toBe("16 out");
    expect(formatDayTime("2026-10-16T17:20:00.000Z")).toBe("16 out, 14:20");
  });

  it("keeps two digits in the day, and the day of São Paulo even when UTC is already the next one", () => {
    expect(formatDay("2026-10-09T13:00:00.000Z")).toBe("09 out");
    expect(formatDayTime("2026-10-10T02:05:00.000Z")).toBe("09 out, 23:05");
  });

  it("writes every month in three letters", () => {
    const months = Array.from({ length: 12 }, (_, month) => formatDay(new Date(Date.UTC(2026, month, 15, 15)).toISOString()));
    expect(months).toEqual(["15 jan", "15 fev", "15 mar", "15 abr", "15 mai", "15 jun", "15 jul", "15 ago", "15 set", "15 out", "15 nov", "15 dez"]);
  });
});

describe("formatTimeAgo", () => {
  const checkedAt = "2026-10-26T13:00:00.000Z";
  const ago = (ms: number) => new Date(new Date(checkedAt).getTime() - ms).toISOString();
  const HOUR = 60 * 60 * 1000;

  it("counts whole days from when the agent looked it up", () => {
    expect(formatTimeAgo(ago(6 * 24 * HOUR), checkedAt)).toBe("há 6 dias");
    expect(formatTimeAgo(ago(30 * HOUR), checkedAt)).toBe("há 1 dia");
  });

  it("counts hours within a day, and says just now under an hour", () => {
    expect(formatTimeAgo(ago(3 * HOUR + 10 * 60 * 1000), checkedAt)).toBe("há 3 horas");
    expect(formatTimeAgo(ago(HOUR), checkedAt)).toBe("há 1 hora");
    expect(formatTimeAgo(ago(20 * 60 * 1000), checkedAt)).toBe("agora há pouco");
    expect(formatTimeAgo(checkedAt, checkedAt)).toBe("agora há pouco");
  });
});
