import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemory, createNexoAgent, simulatedModel } from "@nexo/agent";
import { scriptedModel } from "@nexo/agent/testing";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { migrateDb } from "@/db/migrate";
import { conversations, decisions, messages } from "@/db/schema";
import { seed } from "@/db/seed";
import { chat } from "./chat";
import { ana, fakeTicketService, NOW, rafael, readStream, request, sessionCookieFor, testAgent, testDeps, type TestDeps } from "./test-deps";

// With the clock frozen, the reply falls in the same millisecond as the message, so it is dated 1 ms later.
const REPLY_AT = new Date(NOW.getTime() + 1);

const anaCookie = () => sessionCookieFor({ role: "employee", ...ana });
const post = async (body: unknown, cookie?: string) =>
  request("/api/chat", { method: "POST", body, cookie: cookie ?? (await anaCookie()) });

const decision = {
  understanding: "Erro 809 na VPN",
  action: "Buscar na central de ajuda",
  confidence: 0.86,
  reason: "O artigo do erro 809 pode resolver.",
};
const answer = "No Windows 10, reinstale o cliente de VPN pelo portal de softwares.";
const vpnScript = () => [
  { toolCalls: [{ toolName: "recordDecision", input: decision }] },
  { toolCalls: [{ toolName: "searchArticles", input: { query: "vpn erro 809" } }] },
  { text: answer },
];

async function anaConversation(deps: TestDeps) {
  const [row] = await deps.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.employeeId, ana.id), ne(conversations.state, "closed")));
  return row;
}

async function messagesOf(deps: TestDeps, conversationId: string) {
  return deps.db
    .select({ author: messages.author, text: messages.text, decision: decisions })
    .from(messages)
    .leftJoin(decisions, eq(decisions.messageId, messages.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

describe("POST /api/chat", () => {
  it("answers 401 without a session and 403 for an analyst", async () => {
    const deps = await testDeps();
    expect((await chat(request("/api/chat", { method: "POST", body: { text: "Oi" } }), deps)).status).toBe(401);
    const rafaelCookie = await sessionCookieFor({ role: "analyst", ...rafael });
    expect((await chat(await post({ text: "Oi" }, rafaelCookie), deps)).status).toBe(403);
  });

  it("asks for the message when it is empty", async () => {
    const response = await chat(await post({ text: "  " }), await testDeps());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_body", message: "Escreva sua mensagem." } });
  });

  it("opens the first conversation of the employee and saves the message with the counter at 1", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const response = await chat(await post({ text: "Minha VPN dá erro 809" }), deps);
    expect(response.status).toBe(200);
    await readStream(response);
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(conversation).toMatchObject({ state: "with_agent", messageCount: 1, createdAt: NOW });
    const [first] = await messagesOf(deps, conversation!.id);
    expect(first).toEqual({ author: "employee", text: "Minha VPN dá erro 809", decision: null });
  });

  it("starts the stream with the conversation and its counter", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const chunks = await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));
    const conversation = await anaConversation(deps);
    expect(chunks[0]).toEqual({
      type: "data-conversation",
      data: { id: conversation!.id, state: "with_agent", messageCount: 1 },
      transient: true,
    });
  });

  it("streams the decision first, then the tools and the text in parts", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const chunks = await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));

    const toolInputs = chunks.filter((chunk) => chunk.type === "tool-input-available");
    expect(toolInputs.map((chunk) => [chunk.toolName, chunk.input])).toEqual([
      ["recordDecision", decision],
      ["searchArticles", { query: "vpn erro 809" }],
    ]);
    const deltas = chunks.filter((chunk) => chunk.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((chunk) => chunk.delta).join("")).toBe(answer);
  });

  it("saves the agent reply with its decision and the tools that ran, and marks the first response", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    const [, reply] = await messagesOf(deps, conversation!.id);
    expect(reply).toMatchObject({
      author: "agent",
      text: answer,
      decision: { ...decision, toolsUsed: ["recordDecision", "searchArticles"] },
    });
    expect(conversation?.firstResponseAt).toEqual(REPLY_AT);
  });

  it("saves the reply even when the employee closes the tab in the middle of it", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const response = await chat(await post({ text: "Minha VPN dá erro 809" }), deps);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await deps.settled();

    const [, reply] = await messagesOf(deps, (await anaConversation(deps))!.id);
    expect(reply?.text).toBe(answer);
  });

  it("keeps the same conversation and counts the next message, without moving the first response", async () => {
    const deps = await testDeps({
      agent: testAgent(
        scriptedModel([
          ...vpnScript(),
          { toolCalls: [{ toolName: "recordDecision", input: decision }] },
          { text: "De nada!" },
        ]),
      ),
    });
    await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));
    await deps.settled();
    const later = new Date(NOW.getTime() + 60_000);
    deps.now = () => later;
    const chunks = await readStream(await chat(await post({ text: "Obrigada" }), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(chunks[0]).toMatchObject({ data: { id: conversation!.id, messageCount: 2 } });
    expect(conversation).toMatchObject({ messageCount: 2, firstResponseAt: REPLY_AT });
    expect((await messagesOf(deps, conversation!.id)).map(({ author }) => author)).toEqual([
      "employee",
      "agent",
      "employee",
      "agent",
    ]);
  });

  it("saves the reduced record when the agent did not record its decision", async () => {
    // A model that ignores the forced first step: the code still saves a record, without confidence.
    const deps = await testDeps({ agent: testAgent(scriptedModel([{ text: "Oi!" }])) });
    await readStream(await chat(await post({ text: "Oi" }), deps));
    await deps.settled();

    const [, reply] = await messagesOf(deps, (await anaConversation(deps))!.id);
    expect(reply?.decision).toMatchObject({ understanding: "", confidence: null, reason: null, toolsUsed: [] });
  });

  it("does not call the agent when the conversation is not with it", async () => {
    // Carla's conversation is waiting for an analyst in the sample data.
    const model = scriptedModel(vpnScript());
    const deps = await testDeps({ agent: testAgent(model) });
    const carla = await sessionCookieFor({ role: "employee", id: "emp-carla", name: "Carla Mendes", email: "carla.mendes@nexo.com.br" });
    const response = await chat(await post({ text: "Alguma novidade?" }, carla), deps);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "agent_paused", message: "Sua conversa está com um analista. Ele responde por aqui." },
    });
    expect(model.calls).toHaveLength(0);
    expect(await messagesOf(deps, "conv-carla")).toHaveLength(3);
  });

  it("opens a new conversation when the last one was closed", async () => {
    // Elisa only has closed conversations in the sample data.
    const deps = await testDeps();
    const elisa = await sessionCookieFor({ role: "employee", id: "emp-elisa", name: "Elisa Prado", email: "elisa.prado@nexo.com.br" });
    const chunks = await readStream(await chat(await post({ text: "Oi" }, elisa), deps));
    expect(chunks[0]).toMatchObject({ data: { state: "with_agent", messageCount: 1 } });
    expect((chunks[0]?.data as { id: string }).id).not.toBe("conv-elisa");
  });

  it("does not save or count again the message the agent failed to answer when it is sent again", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([new Error("overloaded"), ...vpnScript()])) });
    await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));
    await deps.settled();
    const chunks = await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(chunks[0]).toMatchObject({ data: { messageCount: 1 } });
    expect(conversation?.messageCount).toBe(1);
    expect((await messagesOf(deps, conversation!.id)).map(({ author }) => author)).toEqual(["employee", "agent"]);
  });

  it("saves the same text again when the previous one was answered", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([...vpnScript(), ...vpnScript()])) });
    await readStream(await chat(await post({ text: "Ainda dá erro 809" }), deps));
    await deps.settled();
    deps.now = () => new Date(NOW.getTime() + 60_000);
    await readStream(await chat(await post({ text: "Ainda dá erro 809" }), deps));
    await deps.settled();

    expect((await anaConversation(deps))?.messageCount).toBe(2);
  });

  it("ends the stream with a short error and saves nothing of the agent when the model fails", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([new Error("overloaded")])) });
    const chunks = await readStream(await chat(await post({ text: "Minha VPN dá erro 809" }), deps));
    await deps.settled();

    expect(chunks).toContainEqual({ type: "error", errorText: "O Nexo não conseguiu responder. Tente de novo." });
    expect(chunks.at(-1)).toEqual({ type: "finish", finishReason: "error" });
    const conversation = await anaConversation(deps);
    expect((await messagesOf(deps, conversation!.id)).map(({ author }) => author)).toEqual(["employee"]);
    expect(conversation?.firstResponseAt).toBeNull();
  });
});

describe("POST /api/chat under concurrent messages", () => {
  it("answers each one at once, with the agent memory writing to the same database file", async () => {
    // A file database, as in production: the route and the agent memory are two clients of the same file.
    // Holding the write lock across awaits would make the other client spin on it for seconds.
    const dir = mkdtempSync(join(tmpdir(), "nexo-chat-"));
    const url = `file:${join(dir, "conversations.db")}`;
    const db = createDb(url);
    await migrateDb(db);
    await seed(db, NOW);
    const ticketService = fakeTicketService();
    const deps = await testDeps({
      db,
      agent: createNexoAgent({ model: simulatedModel({ delayMs: 35 }), memory: createMemory({ url }), helpCenter: ticketService }),
    });
    const employees = [
      { role: "employee" as const, ...ana },
      { role: "employee" as const, id: "emp-bruno", name: "Bruno Tavares", email: "bruno.tavares@nexo.com.br" },
      { role: "employee" as const, id: "emp-elisa", name: "Elisa Prado", email: "elisa.prado@nexo.com.br" },
    ];
    // Warm up: the memory creates its tables on first use.
    await readStream(await chat(await post({ text: "Oi" }, await sessionCookieFor(employees[0]!)), deps));
    await deps.settled();

    const started = performance.now();
    const firstChunks = await Promise.all(
      employees.flatMap((employee) =>
        [1, 2, 3, 4].map(async (n) => {
          const response = await chat(await post({ text: `Qual o horário? ${n}` }, await sessionCookieFor(employee)), deps);
          const reader = response.body!.getReader();
          await reader.read();
          const at = performance.now() - started;
          while (!(await reader.read()).done);
          return at;
        }),
      ),
    );
    await deps.settled();

    expect(Math.max(...firstChunks)).toBeLessThan(1000);
    const counts = await deps.db.select({ employeeId: conversations.employeeId, count: conversations.messageCount }).from(conversations).where(ne(conversations.state, "closed"));
    expect(counts.find(({ employeeId }) => employeeId === "emp-ana")?.count).toBe(5);
    expect(counts.find(({ employeeId }) => employeeId === "emp-elisa")?.count).toBe(4);
  }, 30_000);
});
