import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { messages } from "@/db/schema";
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
  it("returns the active conversation with its messages in order, the agent replies with the parts they streamed", async () => {
    // Bruno is talking to the agent in the sample data.
    const { db } = await testDeps();
    const view = await loadConversation(db, "emp-bruno");
    expect(view.conversation).toEqual({ id: "conv-bruno", state: "with_agent", messageCount: 1 });
    expect(view.messages).toEqual([
      {
        id: "conv-bruno-msg-1",
        role: "user",
        parts: [{ type: "text", text: "Como está meu pedido da licença do Power BI?" }],
      },
      {
        id: "conv-bruno-msg-2",
        role: "assistant",
        parts: [
          {
            type: "tool-recordDecision",
            toolCallId: "conv-bruno-msg-2-decision",
            state: "output-available",
            input: {
              understanding: "Quer saber a situação do pedido de licença do Power BI",
              action: "Consultar os chamados do funcionário",
              confidence: 0.9,
              reason: "Só existe um pedido de Power BI entre os chamados dele.",
            },
            output: { recorded: true },
          },
          {
            type: "text",
            text: "Seu pedido REQ-10450 está aguardando um analista. O prazo dele é de 5 dias úteis desde a abertura, ontem.",
          },
        ],
      },
    ]);
  });

  it("returns a saved message without parts as its text", async () => {
    const { db } = await testDeps();
    await db.update(messages).set({ parts: null }).where(eq(messages.id, "conv-bruno-msg-2"));
    const [, reply] = (await loadConversation(db, "emp-bruno")).messages;
    expect(reply?.parts).toEqual([{ type: "text", text: expect.stringContaining("REQ-10450") }]);
  });

  it("leaves out what is not from the employee or the agent, which comes with the console in feature 5", async () => {
    // Carla's conversation ends with a system message, the transfer.
    const { db } = await testDeps();
    const roles = (await loadConversation(db, "emp-carla")).messages.map(({ role }) => role);
    expect(roles).toEqual(["user", "assistant"]);
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
