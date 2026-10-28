import { describe, expect, it } from "vitest";
import { conversationHandler, loadConversation } from "./conversation";
import { ana, rafael, request, sessionCookieFor, testDeps } from "./test-deps";

const get = (cookie?: string) => request("/api/conversation", { cookie });

describe("GET /api/conversation", () => {
  it("answers 401 without a session and 403 for an analyst", async () => {
    const deps = await testDeps();
    expect((await conversationHandler(get(), deps)).status).toBe(401);
    expect((await conversationHandler(get(await sessionCookieFor({ role: "analyst", ...rafael })), deps)).status).toBe(403);
  });

  it("has no conversation yet for Ana, whose chat starts empty", async () => {
    const response = await conversationHandler(get(await sessionCookieFor({ role: "employee", ...ana })), await testDeps());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ conversation: null, messages: [] });
  });
});

describe("loadConversation", () => {
  it("returns the active conversation with its messages in order and the decision of each agent reply", async () => {
    // Bruno is talking to the agent in the sample data.
    const { db } = await testDeps();
    const view = await loadConversation(db, "emp-bruno");
    expect(view.conversation).toEqual({ id: "conv-bruno", state: "with_agent", messageCount: 1 });
    expect(view.messages).toEqual([
      {
        id: "conv-bruno-msg-1",
        author: "employee",
        text: "Como está meu pedido da licença do Power BI?",
        createdAt: "2026-10-26T12:57:00.000Z",
        decision: null,
      },
      {
        id: "conv-bruno-msg-2",
        author: "agent",
        text: "Seu pedido REQ-10450 está aguardando um analista. O prazo dele é de 5 dias úteis desde a abertura, ontem.",
        createdAt: "2026-10-26T12:57:08.000Z",
        decision: {
          understanding: "Quer saber a situação do pedido de licença do Power BI",
          action: "Consultar os chamados do funcionário",
          confidence: 0.9,
          reason: "Só existe um pedido de Power BI entre os chamados dele.",
          toolsUsed: ["recordDecision", "listMyTickets", "getTicket"],
        },
      },
    ]);
  });

  it("leaves out closed conversations", async () => {
    // Elisa only has closed conversations.
    const { db } = await testDeps();
    expect(await loadConversation(db, "emp-elisa")).toEqual({ conversation: null, messages: [] });
  });

  it("never returns the messages of another employee", async () => {
    const { db } = await testDeps();
    const view = await loadConversation(db, "emp-carla");
    expect(view.conversation?.id).toBe("conv-carla");
    expect(view.messages.every(({ id }) => id.startsWith("conv-carla-"))).toBe(true);
  });
});
