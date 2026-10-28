import { describe, expect, it } from "vitest";
import { chatInput, conversationResponse, decisionRecord, MESSAGE_LIMIT, storedDecision } from "./chat";

describe("chatInput", () => {
  it("trims the text", () => {
    expect(chatInput.parse({ text: "  Minha VPN dá erro 809.  " })).toEqual({ text: "Minha VPN dá erro 809." });
  });

  it("asks for a message when the text is empty or only spaces", () => {
    const parsed = chatInput.safeParse({ text: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("Escreva sua mensagem.");
  });

  it("accepts up to 2,000 characters", () => {
    expect(chatInput.safeParse({ text: "a".repeat(2000) }).success).toBe(true);
    const parsed = chatInput.safeParse({ text: "a".repeat(2001) });
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
  it("allows the reduced record, without confidence or reason", () => {
    const reduced = { understanding: "", action: "Responder", confidence: null, reason: null, toolsUsed: [] };
    expect(storedDecision.parse(reduced)).toEqual(reduced);
  });
});

describe("conversationResponse", () => {
  it("allows an employee without an active conversation", () => {
    expect(conversationResponse.parse({ conversation: null, messages: [] })).toEqual({ conversation: null, messages: [] });
  });

  it("carries the state, the counter and each message with its decision", () => {
    const body = {
      conversation: { id: "conv-1", state: "with_agent", messageCount: 1 },
      messages: [
        { id: "m1", author: "employee", text: "Oi", createdAt: "2026-10-26T13:00:00.000Z", decision: null },
        {
          id: "m2",
          author: "agent",
          text: "Olá!",
          createdAt: "2026-10-26T13:00:08.000Z",
          decision: { understanding: "Cumprimento", action: "Responder", confidence: 0.9, reason: "Só um oi.", toolsUsed: ["recordDecision"] },
        },
      ],
    };
    expect(conversationResponse.parse(body)).toEqual(body);
  });
});

it("limits a conversation to 30 employee messages", () => {
  expect(MESSAGE_LIMIT).toBe(30);
});
