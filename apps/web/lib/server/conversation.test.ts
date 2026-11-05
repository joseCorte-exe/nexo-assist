import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversations, messages } from "@/db/schema";
import { conversationHandler, loadConversation } from "./conversation";
import { ana, NOW, rafael, request, sessionCookieFor, testDeps } from "./test-deps";

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
    expect(await response.json()).toEqual({ conversation: null, messages: [], drafts: [] });
  });
});

describe("loadConversation", () => {
  it("returns the active conversation with its messages in order, the agent replies with the parts they streamed", async () => {
    // Bruno is talking to the agent in the sample data.
    const deps = await testDeps();
    const view = await loadConversation(deps, "emp-bruno");
    expect(view.conversation).toEqual({ id: "conv-bruno", state: "with_agent", messageCount: 1, targetLevel: null, waitUntil: null, analyst: null, limitReached: false });
    expect(view.messages).toEqual([
      {
        id: "conv-bruno-msg-1",
        role: "user",
        metadata: { at: "2026-10-26T12:57:00.000Z" },
        parts: [{ type: "text", text: "Como está meu pedido da licença do Power BI?" }],
      },
      {
        id: "conv-bruno-msg-2",
        role: "assistant",
        metadata: { at: "2026-10-26T12:57:08.000Z" },
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
    const deps = await testDeps();
    await deps.db.update(messages).set({ parts: null }).where(eq(messages.id, "conv-bruno-msg-2"));
    const [, reply] = (await loadConversation(deps, "emp-bruno")).messages;
    expect(reply?.parts).toEqual([{ type: "text", text: expect.stringContaining("REQ-10450") }]);
  });

  it("returns a saved reply whose parts no longer match the tools as its text", async () => {
    const deps = await testDeps();
    const broken = [{ type: "tool-searchArticles", toolCallId: "c1", state: "output-available", input: { query: 42 }, output: {} }];
    await deps.db.update(messages).set({ parts: broken as never }).where(eq(messages.id, "conv-bruno-msg-2"));
    const [, reply] = (await loadConversation(deps, "emp-bruno")).messages;
    expect(reply?.parts).toEqual([{ type: "text", text: expect.stringContaining("REQ-10450") }]);
  });

  it("brings the notes of the console, which the chat draws between the messages", async () => {
    // Carla's conversation ends with a system message, the transfer.
    const deps = await testDeps();
    const loaded = await loadConversation(deps, "emp-carla");
    expect(loaded.messages.map(({ role }) => role)).toEqual(["user", "assistant", "system"]);
    expect(loaded.messages[2]?.parts).toEqual([
      { type: "data-note", data: { event: "transferred", level: "N1", at: "2026-10-26T12:48:00.000Z" } },
    ]);
  });

  it("leaves out the notes of what she did in a card: the card shows it", async () => {
    const deps = await testDeps();
    await deps.db.insert(messages).values({
      id: "note-draft-1-cancelled",
      conversationId: "conv-carla",
      author: "system",
      text: "Descartei o rascunho D-381. Nada foi enviado.",
      parts: null,
      createdAt: new Date("2026-10-26T12:59:00.000Z"),
    });
    const roles = (await loadConversation(deps, "emp-carla")).messages.map(({ role }) => role);
    expect(roles).toEqual(["user", "assistant", "system"]);
  });

  it("without an active conversation, returns the last one that ended, so she reads how it ended", async () => {
    // Elisa only has closed conversations; the newest ended 2 hours ago.
    const deps = await testDeps();
    const view = await loadConversation(deps, "emp-elisa");
    expect(view.conversation).toMatchObject({ id: "conv-elisa", state: "closed", limitReached: false });
    expect(view.messages.at(-1)?.parts).toEqual([{ type: "text", text: "Resolveu, obrigada!" }]);
  });

  it("prefers the active conversation to any that ended", async () => {
    // Carla waits for an analyst and has three past conversations that ended.
    const deps = await testDeps();
    expect((await loadConversation(deps, "emp-carla")).conversation?.id).toBe("conv-carla");
  });

  it("says the limit applied to the conversation", async () => {
    const deps = await testDeps();
    await deps.db.update(conversations).set({ limitReachedAt: NOW, messageCount: 30 }).where(eq(conversations.id, "conv-carla"));
    expect((await loadConversation(deps, "emp-carla")).conversation).toMatchObject({ messageCount: 30, limitReached: true });
  });

  it("dates every message, for the pills of each day", async () => {
    const deps = await testDeps();
    const { messages: shown } = await loadConversation(deps, "emp-carla");
    const saved = await deps.db.select().from(messages).where(eq(messages.conversationId, "conv-carla")).orderBy(messages.createdAt);
    expect(shown.map((message) => message.metadata)).toEqual(saved.map((row) => ({ at: row.createdAt.toISOString() })));
  });

  it("never returns the messages of another employee", async () => {
    const deps = await testDeps();
    const view = await loadConversation(deps, "emp-carla");
    expect(view.conversation?.id).toBe("conv-carla");
    expect(view.messages.every(({ id }) => id.startsWith("conv-carla-"))).toBe(true);
  });
});
