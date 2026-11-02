import { describe, expect, it } from "vitest";
import { chatNote } from "./chat";
import {
  analystMessageInput,
  availabilityInput,
  consoleListQuery,
  contactText,
  employeeNoteLabel,
  conversationTag,
  listTime,
  noteLabel,
  ticketLine,
} from "./console";

// 2026-10-26 is a Monday. Times are São Paulo local (-03:00).
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at("2026-10-26T10:15");
const RAFAEL = { id: "analyst-rafael", name: "Rafael Lima", level: "N2" } as const;
const JULIANA = { id: "analyst-juliana", name: "Juliana Costa", level: "N1" } as const;

const waiting = {
  state: "waiting_for_analyst",
  outcome: null,
  transferReason: "employee_request",
  transferConfidence: null,
  ticketId: null,
  waitUntil: at("2026-10-26T10:40").toISOString(),
  analyst: null,
} as const;

describe("conversationTag", () => {
  it("names the ticket of a transferred conversation, in red", () => {
    expect(conversationTag({ ...waiting, ticketId: "INC-20311" }, RAFAEL.id, NOW)).toEqual({ tone: "danger", text: "Transferida · INC-20311" });
  });

  it("says when the contact is due when there is no ticket", () => {
    expect(conversationTag(waiting, RAFAEL.id, NOW)).toEqual({ tone: "danger", text: "Transferida · contato em 25 min" });
  });

  it("tells the agent asked for help, with its confidence, before anything else", () => {
    const unsure = { ...waiting, transferReason: "agent_unsure", transferConfidence: 0.41, ticketId: "INC-20311" } as const;
    expect(conversationTag(unsure, RAFAEL.id, NOW)).toEqual({ tone: "warning", text: "Agent pediu ajuda · confiança 41%" });
  });

  it("never rounds a low confidence up", () => {
    const unsure = { ...waiting, transferReason: "agent_unsure", transferConfidence: 0.599 } as const;
    expect(conversationTag(unsure, RAFAEL.id, NOW).text).toBe("Agent pediu ajuda · confiança 59%");
    const unknown = { ...waiting, transferReason: "agent_unsure", transferConfidence: null } as const;
    expect(conversationTag(unknown, RAFAEL.id, NOW).text).toBe("Agent pediu ajuda");
  });

  it("tells the analyst a conversation is theirs, or whose it is", () => {
    const assumed = { ...waiting, state: "with_analyst", analyst: RAFAEL } as const;
    expect(conversationTag(assumed, RAFAEL.id, NOW)).toEqual({ tone: "primary", text: "Você está atendendo" });
    expect(conversationTag(assumed, JULIANA.id, NOW)).toEqual({ tone: "primary", text: "Rafael Lima atendendo" });
  });

  it("marks a conversation with the agent", () => {
    const withAgent = { ...waiting, state: "with_agent", transferReason: null, waitUntil: null } as const;
    expect(conversationTag(withAgent, RAFAEL.id, NOW)).toEqual({ tone: "success", text: "Agent atendendo" });
  });

  it("tells how a closed conversation ended", () => {
    const closed = { ...waiting, state: "closed", transferReason: null, waitUntil: null } as const;
    expect(conversationTag({ ...closed, outcome: "resolved_by_agent" }, RAFAEL.id, NOW)).toEqual({ tone: "muted", text: "Resolvida pelo agent" });
    expect(conversationTag({ ...closed, outcome: "closed_by_analyst", analyst: JULIANA }, RAFAEL.id, NOW).text).toBe("Encerrada por Juliana Costa");
    expect(conversationTag({ ...closed, outcome: "closed_by_analyst", analyst: RAFAEL }, RAFAEL.id, NOW).text).toBe("Encerrada por você");
    expect(conversationTag({ ...closed, outcome: "limit_reached" }, RAFAEL.id, NOW).text).toBe("Limite de mensagens");
  });
});

describe("contactText", () => {
  it("counts the minutes left within the hour, rounding up", () => {
    expect(contactText(at("2026-10-26T10:40").toISOString(), NOW)).toBe("contato em 25 min");
    expect(contactText(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toBe("contato em 1 min");
  });

  it("says the time on the same day, and the day after it", () => {
    expect(contactText(at("2026-10-26T14:15").toISOString(), NOW)).toBe("contato até 14:15");
    expect(contactText(at("2026-10-29T10:15").toISOString(), NOW)).toBe("contato até 29 out");
  });

  it("says when the wait is over", () => {
    expect(contactText(at("2026-10-26T10:10").toISOString(), NOW)).toBe("contato atrasado");
  });
});

describe("listTime", () => {
  it("says agora for the last minute", () => {
    expect(listTime(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe("agora");
  });

  it("says the time today, ontem for yesterday and the day before that", () => {
    expect(listTime(at("2026-10-26T09:58").toISOString(), NOW)).toBe("09:58");
    expect(listTime(at("2026-10-25T23:59").toISOString(), NOW)).toBe("ontem");
    expect(listTime(at("2026-10-24T08:00").toISOString(), NOW)).toBe("24 out");
  });

  it("counts days in São Paulo, not in UTC", () => {
    // 01:00 UTC on the 26th is still the 25th in São Paulo.
    expect(listTime("2026-10-26T01:00:00Z", NOW)).toBe("ontem");
  });
});

describe("noteLabel", () => {
  it("writes each note as the design does, without the time", () => {
    expect(noteLabel({ event: "transferred", level: "N2" })).toBe("Transferida para Suporte N2");
    expect(noteLabel({ event: "assumed", level: "N2", analystName: "Rafael Lima" })).toBe("Rafael Lima assumiu · agent pausado");
    expect(noteLabel({ event: "released", analystName: "Rafael Lima" })).toBe("Rafael Lima devolveu ao agent");
    expect(noteLabel({ event: "closed", analystName: "Rafael Lima" })).toBe("Rafael Lima encerrou o atendimento");
  });
});

describe("ticketLine", () => {
  it("says the status of an open ticket and when a resolved one was resolved", () => {
    expect(ticketLine({ id: "INC-20298", status: "in_progress", resolvedAt: null })).toBe("INC-20298 · Em andamento");
    expect(ticketLine({ id: "INC-19877", status: "resolved", resolvedAt: at("2026-09-02T15:00").toISOString() })).toBe("INC-19877 · Resolvido em 02 set");
  });
});

describe("contracts of the console", () => {
  it("reads the filter and the search of the list", () => {
    expect(consoleListQuery.parse({})).toEqual({ filter: "all" });
    expect(consoleListQuery.parse({ filter: "for_you", search: "  ana  " })).toEqual({ filter: "for_you", search: "ana" });
    expect(consoleListQuery.parse({ search: "   " })).toEqual({ filter: "all" });
    expect(consoleListQuery.safeParse({ filter: "mine_and_others" }).success).toBe(false);
    expect(consoleListQuery.safeParse({ search: "x".repeat(101) }).success).toBe(false);
  });

  it("takes an analyst message with the id the console gave it", () => {
    expect(analystMessageInput.parse({ id: "msg-1", text: "  Oi, Ana!  " })).toEqual({ id: "msg-1", text: "Oi, Ana!" });
    expect(analystMessageInput.safeParse({ id: "msg 1", text: "Oi" }).success).toBe(false);
    expect(analystMessageInput.safeParse({ id: "msg-1", text: "   " }).success).toBe(false);
  });

  it("takes the availability as a boolean", () => {
    expect(availabilityInput.parse({ available: false })).toEqual({ available: false });
    expect(availabilityInput.safeParse({ available: "false" }).success).toBe(false);
  });
});

describe("chatNote", () => {
  const at = "2026-10-26T13:05:00.000Z";

  it("reads each note with what its sentence needs, the notes saved with empty fields included", () => {
    expect(chatNote.parse({ event: "transferred", level: "N2", analystName: null, at })).toEqual({ event: "transferred", level: "N2", at });
    expect(chatNote.parse({ event: "released", level: null, analystName: "Rafael Lima", at })).toEqual({ event: "released", analystName: "Rafael Lima", at });
  });

  it("refuses a note without who or where to", () => {
    expect(chatNote.safeParse({ event: "transferred", level: null, at }).success).toBe(false);
    expect(chatNote.safeParse({ event: "assumed", level: "N2", analystName: null, at }).success).toBe(false);
  });
});

describe("employeeNoteLabel", () => {
  it("tells her the notes in her words: the Nexo, not the agent", () => {
    expect(employeeNoteLabel({ event: "transferred", level: "N2" })).toBe("Transferida para Suporte N2");
    expect(employeeNoteLabel({ event: "assumed", level: "N2", analystName: "Rafael Lima" })).toBe("Rafael Lima entrou na conversa");
    expect(employeeNoteLabel({ event: "released", analystName: "Rafael Lima" })).toBe("Rafael Lima devolveu a conversa ao Nexo");
    expect(employeeNoteLabel({ event: "closed", analystName: "Rafael Lima" })).toBe("Rafael Lima encerrou o atendimento");
  });
});
