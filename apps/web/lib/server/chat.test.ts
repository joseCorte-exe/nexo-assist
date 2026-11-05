import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemory, createNexoAgent, simulatedModel } from "@nexo/agent";
import { scriptedModel } from "@nexo/agent/testing";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { migrateDb } from "@/db/migrate";
import { conversations, decisions, drafts, messages } from "@/db/schema";
import { seed } from "@/db/seed";
import { chat } from "./chat";
import { loadConversation } from "./conversation";
import { createDraftStore } from "./drafts";
import { createTransferStore } from "./transfers";
import {
  ana,
  conversationAt,
  fakeTicketService,
  NOW,
  rafael,
  readStream,
  request,
  sessionCookieFor,
  testAgent,
  testDeps,
  type TestDeps,
  vpnArticle,
} from "./test-deps";

// With the clock frozen, the reply falls in the same millisecond as the message, so it is dated 1 ms later.
const REPLY_AT = new Date(NOW.getTime() + 1);

const anaCookie = () => sessionCookieFor({ role: "employee", ...ana });
const post = async (body: unknown, cookie?: string) =>
  request("/api/chat", { method: "POST", body, cookie: cookie ?? (await anaCookie()) });
/** A new message, with the id the chat gives it. */
const say = (text: string, cookie?: string) => post({ id: `msg-${randomUUID()}`, text }, cookie);

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
    .select({ id: messages.id, author: messages.author, text: messages.text, parts: messages.parts, createdAt: messages.createdAt, decision: decisions })
    .from(messages)
    .leftJoin(decisions, eq(decisions.messageId, messages.id))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

describe("POST /api/chat", () => {
  it("answers 401 without a session and 403 for an analyst", async () => {
    const deps = await testDeps();
    expect((await chat(request("/api/chat", { method: "POST", body: { id: "msg-1", text: "Oi" } }), deps)).status).toBe(401);
    const rafaelCookie = await sessionCookieFor({ role: "analyst", ...rafael });
    expect((await chat(await say("Oi", rafaelCookie), deps)).status).toBe(403);
  });

  it("asks for the message when it is empty", async () => {
    const response = await chat(await say("  "), await testDeps());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_body", message: "Escreva sua mensagem." } });
  });

  it("opens the first conversation of the employee and saves the message, under its id, with the counter at 1", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const response = await chat(await post({ id: "msg-ana-1", text: "Minha VPN dá erro 809" }), deps);
    expect(response.status).toBe(200);
    await readStream(response);
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(conversation).toMatchObject({ state: "with_agent", messageCount: 1, createdAt: NOW });
    const [first] = await messagesOf(deps, conversation!.id);
    expect(first).toEqual({ id: "msg-ana-1", author: "employee", text: "Minha VPN dá erro 809", parts: null, createdAt: NOW, decision: null });
  });

  it("starts the stream with the conversation and its counter", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const chunks = await readStream(await chat(await say("Minha VPN dá erro 809"), deps));
    const conversation = await anaConversation(deps);
    expect(chunks[0]).toEqual({
      type: "data-conversation",
      data: { id: conversation!.id, state: "with_agent", messageCount: 1, targetLevel: null, waitUntil: null, analyst: null, limitReached: false },
    });
  });

  it("streams the decision first, then the tools and the text in parts", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const chunks = await readStream(await chat(await say("Minha VPN dá erro 809"), deps));

    const toolInputs = chunks.filter((chunk) => chunk.type === "tool-input-available");
    expect(toolInputs.map((chunk) => [chunk.toolName, chunk.input])).toEqual([
      ["recordDecision", decision],
      ["searchArticles", { query: "vpn erro 809" }],
    ]);
    const deltas = chunks.filter((chunk) => chunk.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((chunk) => chunk.delta).join("")).toBe(answer);
  });

  it("saves the agent reply with the parts it streamed, its decision and the tools that ran, and marks the first response", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    await readStream(await chat(await say("Minha VPN dá erro 809"), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    const [, reply] = await messagesOf(deps, conversation!.id);
    expect(reply).toMatchObject({
      author: "agent",
      text: answer,
      decision: { ...decision, toolsUsed: ["recordDecision", "searchArticles"] },
    });
    // The same parts the screen drew, without the counter, which only belongs to that moment.
    const parts = reply!.parts!.filter((part) => part.type !== "step-start");
    expect(parts.map((part) => part.type)).toEqual(["tool-recordDecision", "tool-searchArticles", "text"]);
    expect(parts[1]).toMatchObject({ state: "output-available", output: { ok: true, articles: [vpnArticle] } });
    expect(parts[2]).toMatchObject({ text: answer });
    // The reply goes right after her message; the first response is when it was saved.
    expect(reply?.createdAt).toEqual(REPLY_AT);
    expect(conversation?.firstResponseAt).toEqual(NOW);
  });

  it("saves a search the help center did not answer as failed, as the screen showed it", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript()), fakeTicketService({ down: true })) });
    await readStream(await chat(await say("Minha VPN dá erro 809"), deps));
    await deps.settled();

    const [, reply] = await messagesOf(deps, (await anaConversation(deps))!.id);
    expect(reply!.parts!.find((part) => part.type === "tool-searchArticles")).toMatchObject({
      output: { ok: false, message: "A central de ajuda não respondeu." },
    });
  });

  it("saves the reply even when the employee closes the tab in the middle of it", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(vpnScript())) });
    const response = await chat(await say("Minha VPN dá erro 809"), deps);
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
    await readStream(await chat(await say("Minha VPN dá erro 809"), deps));
    await deps.settled();
    const later = new Date(NOW.getTime() + 60_000);
    deps.now = () => later;
    const chunks = await readStream(await chat(await say("Obrigada"), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(chunks[0]).toMatchObject({ data: { id: conversation!.id, messageCount: 2 } });
    expect(conversation).toMatchObject({ messageCount: 2, firstResponseAt: NOW });
    expect((await messagesOf(deps, conversation!.id)).map(({ author }) => author)).toEqual([
      "employee",
      "agent",
      "employee",
      "agent",
    ]);
  });

  it("saves the reduced record when the agent did not record its decision", async () => {
    // A model that ignores the forced first step: the code still saves a record, with only the tools that ran.
    const deps = await testDeps({ agent: testAgent(scriptedModel([{ text: "Oi!" }])) });
    await readStream(await chat(await say("Oi"), deps));
    await deps.settled();

    const [, reply] = await messagesOf(deps, (await anaConversation(deps))!.id);
    expect(reply?.decision).toMatchObject({ understanding: null, action: null, confidence: null, reason: null, toolsUsed: [] });
  });

  it("saves and counts a message while the conversation waits for an analyst, without calling the agent", async () => {
    // Carla's conversation is waiting for an analyst in the sample data.
    const model = scriptedModel(vpnScript());
    const deps = await testDeps({ agent: testAgent(model) });
    const carla = await sessionCookieFor({ role: "employee", id: "emp-carla", name: "Carla Mendes", email: "carla.mendes@nexo.com.br" });
    const response = await chat(await post({ id: "msg-carla-9", text: "Alguma novidade?" }, carla), deps);

    expect(response.status).toBe(200);
    // Only the conversation, with the new counter: nobody answers until the analyst does.
    const chunks = await readStream(response);
    expect(chunks.map((chunk) => chunk.type)).toEqual(["start", "data-conversation", "finish"]);
    // The whole conversation as the chat shows it: who she waits for, and until when.
    expect(chunks[1]).toEqual({
      type: "data-conversation",
      data: { id: "conv-carla", state: "waiting_for_analyst", messageCount: 2, targetLevel: "N1", waitUntil: "2026-10-29T12:48:00.000Z", analyst: null, limitReached: false },
    });
    expect(model.calls).toHaveLength(0);
    const saved = await messagesOf(deps, "conv-carla");
    expect(saved.at(-1)).toMatchObject({ id: "msg-carla-9", author: "employee", text: "Alguma novidade?" });
    // Copied to the agent memory as she wrote it, so the agent knows it if the conversation comes back.
    expect(deps.notes).toEqual(["Alguma novidade?"]);
  });

  it("does not save a message sent again while paused twice", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([])) });
    const carla = await sessionCookieFor({ role: "employee", id: "emp-carla", name: "Carla Mendes", email: "carla.mendes@nexo.com.br" });
    await readStream(await chat(await post({ id: "msg-carla-9", text: "Alguma novidade?" }, carla), deps));
    const again = await readStream(await chat(await post({ id: "msg-carla-9", text: "Alguma novidade?" }, carla), deps));
    expect(again[1]).toMatchObject({ data: { messageCount: 2 } });
    expect((await messagesOf(deps, "conv-carla")).filter((message) => message.id === "msg-carla-9")).toHaveLength(1);
  });

  it("opens a new conversation when the last one was closed", async () => {
    // Elisa only has closed conversations in the sample data.
    const deps = await testDeps();
    const elisa = await sessionCookieFor({ role: "employee", id: "emp-elisa", name: "Elisa Prado", email: "elisa.prado@nexo.com.br" });
    const chunks = await readStream(await chat(await say("Oi", elisa), deps));
    expect(chunks[0]).toMatchObject({ data: { state: "with_agent", messageCount: 1 } });
    expect((chunks[0]?.data as { id: string }).id).not.toBe("conv-elisa");
  });

  it("answers a message sent again under the same id without saving or counting it twice", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([new Error("overloaded"), ...vpnScript()])) });
    const message = { id: "msg-ana-1", text: "Minha VPN dá erro 809" };
    await readStream(await chat(await post(message), deps));
    await deps.settled();
    const chunks = await readStream(await chat(await post(message), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(chunks[0]).toMatchObject({ data: { messageCount: 1 } });
    expect(conversation?.messageCount).toBe(1);
    expect((await messagesOf(deps, conversation!.id)).map(({ author }) => author)).toEqual(["employee", "agent"]);
  });

  it("saves the same text again under a new id: it is a new message", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([...vpnScript(), ...vpnScript()])) });
    await readStream(await chat(await say("Ainda dá erro 809"), deps));
    await deps.settled();
    deps.now = () => new Date(NOW.getTime() + 60_000);
    await readStream(await chat(await say("Ainda dá erro 809"), deps));
    await deps.settled();

    expect((await anaConversation(deps))?.messageCount).toBe(2);
  });

  it("refuses an id sent again with another text, which would be answered without being saved or counted", async () => {
    const model = scriptedModel([new Error("overloaded"), ...vpnScript()]);
    const deps = await testDeps({ agent: testAgent(model) });
    await readStream(await chat(await post({ id: "msg-ana-1", text: "Minha VPN dá erro 809" }), deps));
    await deps.settled();
    const response = await chat(await post({ id: "msg-ana-1", text: "Outra pergunta" }), deps);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("message_conflict");
    expect(model.calls).toHaveLength(1);
  });

  it("says a message sent again was already answered, so the chat can load the reply instead", async () => {
    // The network dropped the response after the reply was saved, and the employee pressed "Tentar de novo".
    const model = scriptedModel([...vpnScript(), ...vpnScript()]);
    const deps = await testDeps({ agent: testAgent(model) });
    const message = { id: "msg-ana-1", text: "Minha VPN dá erro 809" };
    await readStream(await chat(await post(message), deps));
    await deps.settled();
    const response = await chat(await post(message), deps);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("already_answered");
    expect(model.calls).toHaveLength(3);
  });

  it("refuses the id of a message of another conversation, without answering or counting", async () => {
    // Bruno's first message in the sample data.
    const model = scriptedModel(vpnScript());
    const deps = await testDeps({ agent: testAgent(model) });
    const response = await chat(await post({ id: "conv-bruno-msg-1", text: "Oi" }), deps);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("message_conflict");
    expect(model.calls).toHaveLength(0);
    expect((await anaConversation(deps))?.messageCount).toBe(0);
  });

  it("ends the stream with a short error and saves nothing of the agent when the model fails", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel([new Error("overloaded")])) });
    const chunks = await readStream(await chat(await say("Minha VPN dá erro 809"), deps));
    await deps.settled();

    expect(chunks).toContainEqual({ type: "error", errorText: "O Nexo não conseguiu responder. Tente de novo." });
    expect(chunks.at(-1)).toEqual({ type: "finish", finishReason: "error" });
    const conversation = await anaConversation(deps);
    expect((await messagesOf(deps, conversation!.id)).map(({ author }) => author)).toEqual(["employee"]);
    expect(conversation?.firstResponseAt).toBeNull();
  });
});

describe("POST /api/chat looking up tickets (feature 3)", () => {
  /** Ana asks with the simulated model, which goes through the real agent, tools and ticket-service client. */
  async function ask(text: string) {
    const deps = await testDeps();
    const chunks = await readStream(await chat(await say(text), deps));
    await deps.settled();
    const conversation = await anaConversation(deps);
    const [, reply] = await messagesOf(deps, conversation!.id);
    const parts = reply!.parts!.filter((part) => part.type !== "step-start");
    return { chunks, reply: reply!, parts };
  }

  it("lists Ana's open tickets and offers the choice, saved with the question and the rows the screen draws", async () => {
    const { parts, reply } = await ask("Qual o status do meu chamado?");
    expect(parts.map((part) => part.type)).toEqual(["tool-recordDecision", "tool-listMyTickets", "tool-offerTicketChoice"]);
    const choice = parts[2] as { state: string; input: { question: string }; output: { ok: boolean; tickets: Array<{ id: string }> } };
    expect(choice.input.question).toBe("Você tem 3 chamados abertos. Sobre qual deles quer saber?");
    expect(choice.state).toBe("output-available");
    expect(choice.output.tickets.map((ticket) => ticket.id)).toEqual(["INC-20311", "INC-20298", "REQ-10442"]);
    expect(reply.decision?.toolsUsed).toEqual(["recordDecision", "listMyTickets", "offerTicketChoice"]);
  });

  it("looks the ticket up by its number and saves the card and the offer of an analyst", async () => {
    const { parts } = await ask("INC-20311 · Notebook lento após atualização do Windows");
    expect(parts.map((part) => part.type)).toEqual(["tool-recordDecision", "tool-getTicket", "tool-offerReplies"]);
    expect(parts[1]).toMatchObject({
      state: "output-available",
      output: { ok: true, ticket: { id: "INC-20311", overdue: true, daysSinceUpdate: 6, deadline: "3 dias úteis" } },
    });
    expect(parts[2]).toMatchObject({
      input: {
        question: expect.stringContaining("Quer que eu chame um analista?"),
        options: ["Falar com um analista", "Adicionar informação", "Não, obrigado"],
      },
    });
  });

  it("never shows Ana a ticket of somebody else, even with its number", async () => {
    // INC-20319 is Diego's.
    const { parts, reply } = await ask("Como está o INC-20319?");
    expect(parts[1]).toMatchObject({ type: "tool-getTicket", output: { ok: false, reason: "not_found" } });
    expect(reply.text).toContain("Não encontrei o INC-20319 entre os seus chamados.");
    expect(JSON.stringify(parts)).not.toContain("Sistema de pedidos");
  });

  it("reads the saved reply back with its tool parts, checked against the same schemas", async () => {
    const deps = await testDeps();
    await readStream(await chat(await say("Qual o status do meu chamado?"), deps));
    await deps.settled();
    const { messages: saved } = await loadConversation(deps, ana.id);
    const types = saved.at(-1)?.parts.map((part) => part.type).filter((type) => type !== "step-start");
    expect(types).toEqual(["tool-recordDecision", "tool-listMyTickets", "tool-offerTicketChoice"]);
  });
});

describe("POST /api/chat opening a ticket (feature 4)", () => {
  const vpnDraft = {
    operation: "create",
    title: "VPN não conecta no notebook — erro 809",
    description: "Desde ontem o notebook (Windows 11) não conecta na VPN e mostra o erro 809. Precisa dela para a reunião das 14h.",
    category: "network_vpn",
    subcategory: "VPN",
    impact: "stopped",
    urgency: "same_day",
    affected: "only_me",
  };
  const aboveTheCard = "Coloquei prioridade alta por causa da reunião. Confira antes de eu criar:";

  it("saves the draft in the conversation of the turn and streams it, with the priority the code gave it", async () => {
    const deps = await testDeps({
      model: scriptedModel([
        { toolCalls: [{ toolName: "recordDecision", input: decision }] },
        { toolCalls: [{ toolName: "draftTicket", input: vpnDraft }] },
        { text: aboveTheCard },
      ]),
    });
    const chunks = await readStream(await chat(await say("Só eu. Tenho reunião às 14h."), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    const saved = await deps.db.select().from(drafts);
    expect(saved).toMatchObject([{ conversationId: conversation!.id, status: "pending", priority: "high", number: 381 }]);
    const output = chunks.find((chunk) => chunk.type === "tool-output-available" && chunk.toolCallId?.toString().includes("call-2"));
    expect(output).toMatchObject({ output: { ok: true, draft: { id: saved[0]!.id, priority: "high" }, dueText: "hoje, até 14:00" } });
  });

  it("saves a tool input the agent refused as an error of the tool, so the reply still reads back whole", async () => {
    const deps = await testDeps({
      model: scriptedModel([
        { toolCalls: [{ toolName: "recordDecision", input: decision }] },
        { toolCalls: [{ toolName: "draftTicket", input: { operation: "create", description: "VPN" } }] },
        { toolCalls: [{ toolName: "draftTicket", input: vpnDraft }] },
        { text: aboveTheCard },
      ]),
    });
    await readStream(await chat(await say("Só eu. Tenho reunião às 14h."), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    const [, reply] = await messagesOf(deps, conversation!.id);
    const tools = reply!.parts!.filter((part) => part.type === "tool-draftTicket");
    expect(tools.map((part) => part.state)).toEqual(["output-error", "output-available"]);
    expect(tools[0]).toMatchObject({ errorText: expect.stringContaining("Para criar, falta title.") });
    const loaded = await loadConversation(deps, ana.id);
    // Read back whole, not as text only: the refusal as an error of a tool, then the draft and the text.
    const types = loaded.messages.at(-1)?.parts.map((part) => part.type).filter((type) => type !== "step-start");
    expect(types).toEqual(["tool-recordDecision", "dynamic-tool", "tool-draftTicket", "text"]);
  });

  it("discards the draft of a reply that failed after it, which no card will show", async () => {
    const deps = await testDeps({
      model: scriptedModel([
        { toolCalls: [{ toolName: "recordDecision", input: decision }] },
        { toolCalls: [{ toolName: "draftTicket", input: vpnDraft }] },
        new Error("overloaded"),
      ]),
    });
    await readStream(await chat(await say("Só eu. Tenho reunião às 14h."), deps));
    await deps.settled();
    expect((await deps.db.select({ status: drafts.status }).from(drafts)).map((row) => row.status)).toEqual(["cancelled"]);
  });

  it("does not take a note of the screen as the answer to a message that is still unanswered", async () => {
    // The reply failed; meanwhile she cancelled a draft in the card, which left a note; then "Tentar de novo".
    const deps = await testDeps({ agent: testAgent(scriptedModel([new Error("overloaded"), ...vpnScript()])) });
    const message = { id: "msg-ana-1", text: "Minha VPN dá erro 809" };
    await readStream(await chat(await post(message), deps));
    await deps.settled();
    const conversation = await anaConversation(deps);
    await deps.db.insert(messages).values({
      id: "note-1",
      conversationId: conversation!.id,
      author: "system",
      text: "Descartei o rascunho D-381. Nada foi enviado.",
      createdAt: new Date(NOW.getTime() + 1000),
    });

    const response = await chat(await post(message), deps);
    expect(response.status).toBe(200);
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
    const memory = createMemory({ url });
    const deps = await testDeps({
      db,
      agent: createNexoAgent({
        model: simulatedModel({ delayMs: 35 }),
        memory,
        ticketService,
        drafts: createDraftStore(db),
        transfers: createTransferStore({ db, memory }),
      }),
    });
    const employees = [
      { role: "employee" as const, ...ana },
      { role: "employee" as const, id: "emp-bruno", name: "Bruno Tavares", email: "bruno.tavares@nexo.com.br" },
      { role: "employee" as const, id: "emp-elisa", name: "Elisa Prado", email: "elisa.prado@nexo.com.br" },
    ];
    // Warm up: the memory creates its tables on first use.
    await readStream(await chat(await say("Oi", await sessionCookieFor(employees[0]!)), deps));
    await deps.settled();

    const started = performance.now();
    const firstChunks = await Promise.all(
      employees.flatMap((employee) =>
        [1, 2, 3, 4].map(async (n) => {
          const response = await chat(await say(`Qual o horário? ${n}`, await sessionCookieFor(employee)), deps);
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

describe("POST /api/chat at the limit of 30 messages (feature 6)", () => {
  const plain = () => [{ toolCalls: [{ toolName: "recordDecision", input: decision }] }, { text: answer }];
  const asking = () => [
    { toolCalls: [{ toolName: "recordDecision", input: decision }] },
    { text: "Desde quando o notebook está lento?" },
  ];
  const limitNotes = async (deps: TestDeps, id: string) =>
    (await messagesOf(deps, id)).filter((message) => message.parts?.some((part) => part.type === "data-note"));

  it("answers the 30th message, then closes the conversation when nothing is pending", async () => {
    const model = scriptedModel(plain());
    const deps = await testDeps({ agent: testAgent(model) });
    await conversationAt(deps, { count: 29, lastReply: [{ type: "text", text: "Pronto." }] });
    const chunks = await readStream(await chat(await say("Valeu, era isso"), deps));
    await deps.settled();

    // The 30th is counted and answered like any other.
    expect(chunks[0]).toMatchObject({ data: { messageCount: 30, state: "with_agent", limitReached: false } });
    expect(model.calls).toHaveLength(2);
    const [row] = await deps.db.select().from(conversations).where(eq(conversations.id, "conv-ana"));
    expect(row).toMatchObject({ state: "closed", outcome: "limit_reached" });
    // The note goes after the reply.
    const saved = await messagesOf(deps, "conv-ana");
    expect(saved.slice(-3).map(({ author }) => author)).toEqual(["employee", "agent", "system"]);
    expect(await limitNotes(deps, "conv-ana")).toHaveLength(1);
  });

  it("transfers at the limit when the 30th reply asks her something", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(asking())) });
    await conversationAt(deps, { count: 29, lastReply: [{ type: "text", text: "Pronto." }] });
    await readStream(await chat(await say("O notebook está lento"), deps));
    await deps.settled();

    const [row] = await deps.db.select().from(conversations).where(eq(conversations.id, "conv-ana"));
    expect(row).toMatchObject({ state: "waiting_for_analyst", targetLevel: "N1", transferReason: "message_limit" });
  });

  it("opens a new conversation with the message after a conversation the limit closed", async () => {
    const model = scriptedModel([...plain(), ...plain()]);
    const deps = await testDeps({ agent: testAgent(model) });
    await conversationAt(deps, { count: 29, lastReply: [{ type: "text", text: "Pronto." }] });
    await readStream(await chat(await say("Valeu, era isso"), deps));
    await deps.settled();
    deps.now = () => new Date(NOW.getTime() + 60_000);
    const chunks = await readStream(await chat(await say("Outra coisa: a impressora"), deps));
    await deps.settled();

    const conversation = await anaConversation(deps);
    expect(conversation).toMatchObject({ state: "with_agent", messageCount: 1 });
    expect(conversation?.id).not.toBe("conv-ana");
    expect(chunks[0]).toMatchObject({ data: { id: conversation!.id, messageCount: 1, limitReached: false } });
  });

  it("does not let the agent answer a 31st message: the limit applies first, and the message goes where it went", async () => {
    // The 30th was left without an answer (the model failed and she never pressed "Tentar de novo").
    const model = scriptedModel(plain());
    const deps = await testDeps({ agent: testAgent(model) });
    await conversationAt(deps, { count: 30, lastReply: null });
    const chunks = await readStream(await chat(await say("Alguém aí?"), deps));
    await deps.settled();

    expect(model.calls).toHaveLength(0);
    // Her 30th had no answer: pending, so an analyst gets it, and this one waits with it.
    expect(chunks.map((chunk) => chunk.type)).toEqual(["start", "data-conversation", "finish"]);
    expect(chunks[1]).toMatchObject({ data: { id: "conv-ana", state: "waiting_for_analyst", messageCount: 31, limitReached: true } });
    expect((await messagesOf(deps, "conv-ana")).at(-1)).toMatchObject({ author: "employee", text: "Alguém aí?" });
  });

  it("answers the 30th sent again after a failure, before the limit applies", async () => {
    const model = scriptedModel([new Error("overloaded"), ...plain()]);
    const deps = await testDeps({ agent: testAgent(model) });
    await conversationAt(deps, { count: 29, lastReply: [{ type: "text", text: "Pronto." }] });
    const message = { id: "msg-ana-30", text: "Valeu, era isso" };
    await readStream(await chat(await post(message), deps));
    await deps.settled();
    const [still] = await deps.db.select().from(conversations).where(eq(conversations.id, "conv-ana"));
    expect(still).toMatchObject({ state: "with_agent", limitReachedAt: null });

    await readStream(await chat(await post(message), deps));
    await deps.settled();
    const [row] = await deps.db.select().from(conversations).where(eq(conversations.id, "conv-ana"));
    expect(row).toMatchObject({ state: "closed", outcome: "limit_reached", messageCount: 30 });
  });

  it("notes the limit once when she reaches it while an analyst has her, and keeps her writing to the analyst", async () => {
    const model = scriptedModel([]);
    const deps = await testDeps({ agent: testAgent(model) });
    await conversationAt(deps, { count: 29, lastReply: [{ type: "text", text: "Pronto." }], state: "with_analyst" });
    const thirtieth = await readStream(await chat(await say("Obrigada, Rafael"), deps));
    const thirtyFirst = await readStream(await chat(await say("Mais uma coisa"), deps));

    // The message that reached it is answered with the conversation as it came; a paused chat reads it again right after.
    expect(thirtieth[1]).toMatchObject({ data: { state: "with_analyst", messageCount: 30 } });
    expect(thirtyFirst[1]).toMatchObject({ data: { state: "with_analyst", messageCount: 31, limitReached: true } });
    expect(model.calls).toHaveLength(0);
    expect(await limitNotes(deps, "conv-ana")).toHaveLength(1);
  });
});

describe("POST /api/chat coming back another day (feature 6)", () => {
  const plain = () => [{ toolCalls: [{ toolName: "recordDecision", input: decision }] }, { text: answer }];

  it("tells the agent, before her message, that the conversation resumes after a pause on another day", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(plain())) });
    // Her last message was on Friday the 23rd; NOW is Monday the 26th.
    await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Pronto." }], end: new Date("2026-10-23T18:00:00Z") });
    await readStream(await chat(await say("E aí, alguma novidade?"), deps));
    await deps.settled();

    expect(deps.notes).toEqual([
      "(retomada) A conversa continua hoje, 26 out, depois de uma pausa: a mensagem anterior é de 23 out. O que as ferramentas disseram antes pode ter mudado; consulte de novo antes de falar da situação de um chamado.",
    ]);
  });

  it("says nothing to the agent within the same day", async () => {
    const deps = await testDeps({ agent: testAgent(scriptedModel(plain())) });
    await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Pronto." }], end: new Date(NOW.getTime() - 3 * 60 * 60 * 1000) });
    await readStream(await chat(await say("Voltei"), deps));
    await deps.settled();
    expect(deps.notes).toEqual([]);
  });
});
