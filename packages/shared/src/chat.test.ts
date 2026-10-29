import { describe, expect, it } from "vitest";
import { chatInput, decisionRecord, MESSAGE_LIMIT, storedDecision } from "./chat";

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
