import { describe, expect, it } from "vitest";
import {
  chatInput,
  decisionRecord,
  getTicketInput,
  getTicketOutput,
  listMyTicketsInput,
  listMyTicketsOutput,
  MESSAGE_LIMIT,
  offerRepliesInput,
  offerTicketChoiceInput,
  storedDecision,
} from "./chat";

const id = "msg-5f0c1a2e-8d3b-4c7e-9a10-2b6f4e8d1c3a";

describe("chatInput", () => {
  it("takes the id the chat gave the message and the text, trimmed", () => {
    expect(chatInput.parse({ id, text: "  Minha VPN dá erro 809.  " })).toEqual({ id, text: "Minha VPN dá erro 809." });
  });

  it("needs an id of letters, digits and dashes, so sending it again is recognized by it", () => {
    expect(chatInput.safeParse({ text: "Oi" }).success).toBe(false);
    expect(chatInput.safeParse({ id: "", text: "Oi" }).success).toBe(false);
    expect(chatInput.safeParse({ id: "msg 1; drop", text: "Oi" }).success).toBe(false);
    expect(chatInput.safeParse({ id: "m".repeat(101), text: "Oi" }).success).toBe(false);
  });

  it("asks for a message when the text is empty or only spaces", () => {
    const parsed = chatInput.safeParse({ id, text: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Escreva sua mensagem.");
  });

  it("accepts up to 2,000 characters", () => {
    expect(chatInput.safeParse({ id, text: "a".repeat(2000) }).success).toBe(true);
    const parsed = chatInput.safeParse({ id, text: "a".repeat(2001) });
    expect(parsed.error?.issues[0]?.message).toBe("A mensagem pode ter até 2.000 caracteres.");
  });
});

describe("decisionRecord", () => {
  const record = {
    understanding: "Erro 809 na VPN no Windows 10",
    action: "Responder com o artigo da central de ajuda",
    confidence: 0.94,
    reason: "O artigo do erro 809 vale para o Windows 10.",
  };

  it("takes what the agent understood, the action, the confidence and the reason", () => {
    expect(decisionRecord.parse(record)).toEqual(record);
  });

  it("keeps the confidence between 0 and 1", () => {
    expect(decisionRecord.safeParse({ ...record, confidence: 1.2 }).success).toBe(false);
    expect(decisionRecord.safeParse({ ...record, confidence: -0.1 }).success).toBe(false);
    expect(decisionRecord.safeParse({ ...record, confidence: 0 }).success).toBe(true);
  });

  it("needs every field filled", () => {
    expect(decisionRecord.safeParse({ ...record, reason: "" }).success).toBe(false);
    expect(decisionRecord.safeParse({ ...record, understanding: undefined }).success).toBe(false);
  });
});

describe("storedDecision", () => {
  it("keeps the record of the agent with the tools that ran", () => {
    const decision = { record: { understanding: "Oi", action: "Responder", confidence: 0.9, reason: "Só um oi." }, toolsUsed: ["recordDecision"] };
    expect(storedDecision.parse(decision)).toEqual(decision);
  });

  it("has no record at all when the agent did not give one, the reduced record", () => {
    const reduced = { record: null, toolsUsed: ["searchArticles"] };
    expect(storedDecision.parse(reduced)).toEqual(reduced);
  });
});

it("limits a conversation to 30 employee messages", () => {
  expect(MESSAGE_LIMIT).toBe(30);
});

describe("listMyTicketsInput", () => {
  it("lists the open tickets unless the agent asks for all of them", () => {
    expect(listMyTicketsInput.parse({})).toEqual({ scope: "open" });
    expect(listMyTicketsInput.parse({ scope: "all" })).toEqual({ scope: "all" });
    expect(listMyTicketsInput.safeParse({ scope: "others" }).success).toBe(false);
  });

  it("has no employee field: whose tickets they are comes from the session", () => {
    expect(listMyTicketsInput.parse({ scope: "open", employeeId: "emp-carla" })).toEqual({ scope: "open" });
  });
});

describe("getTicketInput", () => {
  it("normalizes the number the agent read in the message", () => {
    expect(getTicketInput.parse({ ticketId: "inc-20311" })).toEqual({ ticketId: "INC-20311" });
  });

  it("rejects what is not a ticket number", () => {
    expect(getTicketInput.safeParse({ ticketId: "o do notebook" }).success).toBe(false);
  });
});

describe("getTicketOutput", () => {
  it("says why it has no ticket: not found or the service is down", () => {
    expect(getTicketOutput.parse({ ok: false, reason: "not_found", message: "Não achei." }).ok).toBe(false);
    expect(getTicketOutput.safeParse({ ok: false, reason: "forbidden", message: "?" }).success).toBe(false);
  });
});

describe("offerTicketChoiceInput", () => {
  const question = "Você tem 2 chamados abertos. Sobre qual deles quer saber?";

  it("offers a choice of 2 to 8 tickets", () => {
    expect(offerTicketChoiceInput.safeParse({ question, ticketIds: ["INC-20311"] }).success).toBe(false);
    expect(offerTicketChoiceInput.parse({ question, ticketIds: ["inc-20311", "REQ-10442"] })).toEqual({
      question,
      ticketIds: ["INC-20311", "REQ-10442"],
    });
    const nine = Array.from({ length: 9 }, (_, index) => `INC-2030${index}`);
    expect(offerTicketChoiceInput.safeParse({ question, ticketIds: nine }).success).toBe(false);
  });

  it("always comes with its question, so the list never shows up without one", () => {
    expect(offerTicketChoiceInput.safeParse({ ticketIds: ["INC-20311", "REQ-10442"] }).success).toBe(false);
    expect(offerTicketChoiceInput.safeParse({ question: "  ", ticketIds: ["INC-20311", "REQ-10442"] }).success).toBe(false);
  });
});

describe("offerRepliesInput", () => {
  const replies = ["Falar com um analista", "Adicionar informação", "Não, obrigado"];
  const question = "Quer que eu chame um analista?";

  it("offers from 2 to 4 short replies, with their question", () => {
    expect(offerRepliesInput.parse({ question, options: replies })).toEqual({ question, options: replies });
    expect(offerRepliesInput.safeParse({ question, options: ["Sim"] }).success).toBe(false);
    expect(offerRepliesInput.safeParse({ question, options: [...replies, "Talvez", "Depois"] }).success).toBe(false);
  });

  it("always comes with its question, so the buttons never show up without one", () => {
    expect(offerRepliesInput.safeParse({ options: replies }).success).toBe(false);
    expect(offerRepliesInput.safeParse({ question: " ", options: replies }).success).toBe(false);
  });

  it("keeps each reply to a button: filled and up to 40 characters", () => {
    expect(offerRepliesInput.safeParse({ question, options: ["Sim", " "] }).success).toBe(false);
    expect(offerRepliesInput.safeParse({ question, options: ["Sim", "a".repeat(41)] }).success).toBe(false);
  });

  it("refuses the same reply twice, which the employee could not tell apart", () => {
    expect(offerRepliesInput.safeParse({ question, options: ["Sim", "sim "] }).success).toBe(false);
  });
});

describe("listMyTicketsOutput", () => {
  it("still reads a reply saved before the tickets resolved in the last days came apart", () => {
    expect(listMyTicketsOutput.safeParse({ ok: true, tickets: [] }).success).toBe(true);
    expect(listMyTicketsOutput.safeParse({ ok: true, tickets: [], recentlyResolved: [] }).success).toBe(true);
  });
});
