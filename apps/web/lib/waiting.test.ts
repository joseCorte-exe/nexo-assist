import { describe, expect, it } from "vitest";
import { waitingText } from "./waiting";

// 2026-10-26 is a Monday. Times are São Paulo local (-03:00).
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at("2026-10-26T10:05");

describe("waitingText", () => {
  it("promises the time of the same day, and says she can write meanwhile", () => {
    expect(waitingText({ waitUntil: at("2026-10-26T12:05").toISOString(), level: "N2" }, NOW)).toEqual({
      title: "Um analista vai falar com você até 12:05",
      body: "Suporte N2 · Pode escrever enquanto espera",
      late: false,
    });
  });

  it("says tomorrow, or the date, when the wait ends on another day", () => {
    expect(waitingText({ waitUntil: at("2026-10-27T09:00").toISOString(), level: "N1" }, NOW).title).toBe("Um analista vai falar com você amanhã até 09:00");
    expect(waitingText({ waitUntil: at("2026-11-03T09:00").toISOString(), level: "N1" }, NOW).title).toBe("Um analista vai falar com você até 03/11, 09:00");
  });

  it("owns up when the time passed and nobody joined, with the phone for what is urgent", () => {
    expect(waitingText({ waitUntil: at("2026-10-26T10:00").toISOString(), level: "N2" }, NOW)).toEqual({
      title: "Passou das 10:00 e o analista ainda não entrou",
      body: "Sua conversa continua na fila. Se for urgente, ligue no ramal 4000.",
      late: true,
    });
  });

  it("promises no time it does not have", () => {
    expect(waitingText({ waitUntil: null, level: null }, NOW)).toEqual({
      title: "Um analista vai falar com você",
      body: "Pode escrever enquanto espera",
      late: false,
    });
  });
});
