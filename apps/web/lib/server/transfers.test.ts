import { randomUUID } from "node:crypto";
import { scriptedModel } from "@nexo/agent/testing";
import { MAX_TRANSFER_SUMMARY } from "@nexo/shared";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { conversations, decisions, drafts, messages } from "@/db/schema";
import { chat } from "./chat";
import { loadConversation } from "./conversation";
import { confirmDraftHandler } from "./drafts";
import { ana, NOW, rafael, readStream, request, sessionCookieFor, testDeps, type TestDeps } from "./test-deps";
import { createTransferStore } from "./transfers";

// The transfer of feature 5 as the chat runs it: the agent (the simulated model, the same the end-to-end tests use)
// calls transferToAnalyst, and the conversation moves in the conversations database with a note the console shows.

/** She says it a minute after what she said before, as she would: the order of the messages is the real one. */
const said = new WeakMap<TestDeps, number>();
const say = async (deps: TestDeps, text: string) => {
  const turn = said.get(deps) ?? 0;
  said.set(deps, turn + 1);
  deps.now = () => new Date(NOW.getTime() + turn * 60_000);
  const cookie = await sessionCookieFor({ role: "employee", ...ana });
  await readStream(await chat(request("/api/chat", { method: "POST", body: { id: `msg-${randomUUID()}`, text }, cookie }), deps));
  await deps.settled();
};

async function anaConversation(deps: TestDeps) {
  const [row] = await deps.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.employeeId, ana.id), ne(conversations.state, "closed")));
  return row!;
}

const notesOf = (deps: TestDeps, conversationId: string) =>
  deps.db
    .select({ id: messages.id, text: messages.text, event: messages.event, authorId: messages.authorId })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.author, "system")));

describe("the transfer in the chat", () => {
  it("moves the conversation to an analyst of N1 when she asks, with the summary, the wait and a note", async () => {
    const deps = await testDeps();
    await say(deps, "Quero falar com um analista.");
    const conversation = await anaConversation(deps);
    expect(conversation).toMatchObject({
      state: "waiting_for_analyst",
      targetLevel: "N1",
      transferReason: "employee_request",
      ticketId: null,
      analystId: null,
      transferredAt: NOW,
      // Medium without a ticket: 3 business days from Monday 10:00.
      waitUntil: new Date("2026-10-29T13:00:00.000Z"),
    });
    expect(conversation.transferSummary).toContain("Quero falar com um analista.");
    const [note] = await notesOf(deps, conversation.id);
    expect(note).toMatchObject({ text: "Transferida para o Suporte N1.", event: "transferred", authorId: null });
  });

  it("takes an overdue ticket to N2 and notes the transfer on it, with the note as the key", async () => {
    const deps = await testDeps();
    await say(deps, "INC-20311 · Notebook lento após atualização do Windows");
    await say(deps, "Falar com um analista");
    const conversation = await anaConversation(deps);
    expect(conversation).toMatchObject({ targetLevel: "N2", transferReason: "overdue", ticketId: "INC-20311" });
    const [note] = await notesOf(deps, conversation.id);
    expect(deps.ticketService.writes).toEqual([
      {
        method: "POST",
        path: "/tickets/INC-20311/transfer",
        body: { employeeId: ana.id, level: "N2", summary: conversation.transferSummary },
        key: note!.id,
      },
    ]);
  });

  it("keeps the confidence of an agent that asked for help, for the console", async () => {
    const deps = await testDeps();
    await say(deps, "Meu Excel fecha sozinho quando abro a planilha de campanhas com macros.");
    expect(await anaConversation(deps)).toMatchObject({ transferReason: "agent_unsure", transferConfidence: 0.41 });
  });

  it("saves the reply that transferred, with the tool among the tools that ran", async () => {
    const deps = await testDeps();
    await say(deps, "Quero falar com um analista.");
    const [reply] = await deps.db
      .select({ text: messages.text, toolsUsed: decisions.toolsUsed })
      .from(messages)
      .innerJoin(decisions, eq(decisions.messageId, messages.id))
      .where(eq(messages.conversationId, (await anaConversation(deps)).id));
    expect(reply).toEqual({
      text: "Encaminhei para o Suporte N1. Um analista vai falar com você até 29 out, 10:00.",
      toolsUsed: ["recordDecision", "transferToAnalyst"],
    });
  });

  it("puts the note after the reply that announced it, as nexo.pen draws them", async () => {
    const deps = await testDeps();
    await say(deps, "Quero falar com um analista.");
    const rows = await deps.db
      .select({ author: messages.author })
      .from(messages)
      .where(eq(messages.conversationId, (await anaConversation(deps)).id))
      .orderBy(messages.createdAt);
    expect(rows.map((row) => row.author)).toEqual(["employee", "agent", "system"]);
  });

  it("shows the employee the note and who she waits for when the chat loads", async () => {
    const deps = await testDeps();
    await say(deps, "Quero falar com um analista.");
    const loaded = await loadConversation(deps, ana.id);
    expect(loaded.conversation).toMatchObject({
      state: "waiting_for_analyst",
      targetLevel: "N1",
      waitUntil: "2026-10-29T13:00:00.000Z",
      analyst: null,
    });
    expect(loaded.messages.at(-1)).toMatchObject({
      role: "system",
      parts: [{ type: "data-note", data: { event: "transferred", level: "N1", at: expect.any(String) } }],
    });
  });
});

describe("createTransferStore", () => {
  const record = (conversationId: string) => ({
    conversationId,
    level: "N2" as const,
    reason: "critical" as const,
    summary: "Sistema de pedidos fora do ar para a equipe.",
    ticketId: null,
    waitUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
    confidence: 0.82,
    turnStartedAt: new Date(NOW.getTime() - 4_000),
    at: NOW,
  });

  it("only moves a conversation still with the agent: an analyst who took it first keeps it", async () => {
    const deps = await testDeps();
    // Fábio's conversation is with Rafael in the sample data.
    const before = await deps.db.select().from(conversations).where(eq(conversations.id, "conv-fabio"));
    const notesBefore = await notesOf(deps, "conv-fabio");
    expect(await createTransferStore(deps).transfer(record("conv-fabio"))).toEqual({ transferred: false });
    expect(await deps.db.select().from(conversations).where(eq(conversations.id, "conv-fabio"))).toEqual(before);
    expect(await notesOf(deps, "conv-fabio")).toEqual(notesBefore);
  });

  it("moves it and leaves the note in one batch, answering the note's id", async () => {
    const deps = await testDeps();
    // Bruno's conversation is with the agent in the sample data.
    const result = await createTransferStore(deps).transfer(record("conv-bruno"));
    expect(result).toMatchObject({ transferred: true });
    const notes = await notesOf(deps, "conv-bruno");
    expect(notes.map((note) => note.id)).toContain((result as { noteId: string }).noteId);
    const [row] = await deps.db.select().from(conversations).where(eq(conversations.id, "conv-bruno"));
    expect(row).toMatchObject({ state: "waiting_for_analyst", targetLevel: "N2", transferReason: "critical", transferConfidence: 0.82, lastActivityAt: NOW });
  });
});

describe("a critical case (Anexo A)", () => {
  const decision = {
    understanding: "O sistema de ponto caiu para a empresa",
    action: "Montar o rascunho do chamado crítico",
    confidence: 0.85,
    reason: "Algo parado para a empresa é crítico.",
  };
  const anaCookie = () => sessionCookieFor({ role: "employee", ...ana });
  /** A new message of hers, with the id the chat gives it. */
  const post = async (text: string, id = `msg-${randomUUID()}`) => request("/api/chat", { method: "POST", body: { id, text }, cookie: await anaCookie() });
  const messagesOf = (deps: TestDeps, conversationId: string) =>
    deps.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
  const pontoDraft = {
    operation: "create",
    title: "Sistema de ponto fora do ar para toda a empresa",
    description: "O sistema de ponto caiu para toda a empresa e ninguém consegue registrar o horário desde hoje de manhã.",
    category: "software",
    subcategory: "Ponto",
    impact: "stopped",
    urgency: "none",
    affected: "company",
  };
  const line = "O caso é crítico porque está parado para a empresa. Encaminhei para o Suporte N2, e um analista vai falar com você hoje, até 11:00.";
  const recorded = { toolCalls: [{ toolName: "recordDecision", input: decision }] };
  const draftThenLine = (input: object = pontoDraft) => [recorded, { toolCalls: [{ toolName: "draftTicket", input }] }, { text: line }];
  const conversationRow = async (deps: TestDeps) => {
    const [row] = await deps.db.select().from(conversations).where(eq(conversations.employeeId, ana.id));
    return row;
  };

  it("transfers it to N2 right after the reply, with the case as the summary and the wait the reply told her", async () => {
    const deps = await testDeps({ model: scriptedModel(draftThenLine()) });
    const chunks = await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();

    expect(await conversationRow(deps)).toMatchObject({
      state: "waiting_for_analyst",
      targetLevel: "N2",
      transferReason: "critical",
      transferSummary: `${pontoDraft.title}. ${pontoDraft.description}`,
      transferConfidence: decision.confidence,
      ticketId: null,
      waitUntil: new Date("2026-10-26T14:00:00.000Z"),
    });
    // It streamed as with the agent: the transfer came after the reply, and the chat reads it again then.
    expect(chunks[0]).toMatchObject({ data: { state: "with_agent" } });
    const output = chunks.find((chunk) => chunk.type === "tool-output-available" && (chunk.output as { draft?: unknown }).draft);
    expect(output).toMatchObject({ output: { dueText: "hoje, até 11:00" } });
    const saved = await messagesOf(deps, (await conversationRow(deps))!.id);
    expect(saved.map(({ author }) => author)).toEqual(["employee", "agent", "system"]);
    expect(saved.at(-1)?.parts).toEqual([{ type: "data-note", data: { event: "transferred", level: "N2", at: NOW.toISOString() } }]);
  });

  it("keeps the card, which she can still confirm with the conversation waiting for the analyst", async () => {
    const deps = await testDeps({ model: scriptedModel(draftThenLine()) });
    await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();
    const [draft] = await deps.db.select().from(drafts);
    expect(draft).toMatchObject({ status: "pending", priority: "critical" });

    const confirmed = await confirmDraftHandler(request(`/api/drafts/${draft!.id}/confirm`, { method: "POST", cookie: await anaCookie() }), deps, draft!.id);

    expect(await confirmed.json()).toMatchObject({ status: "confirmed", priority: "critical" });
    expect(await conversationRow(deps)).toMatchObject({ state: "waiting_for_analyst", targetLevel: "N2" });
  });

  it("does not ask the model for anything but its sentence once the case is drafted, without a second transfer", async () => {
    const model = scriptedModel(draftThenLine());
    const deps = await testDeps({ model });
    await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();

    expect((model.calls[2]!.tools ?? []).map((tool) => tool.name)).toEqual(["updateWorkingMemory"]);
    const notes = (await messagesOf(deps, (await conversationRow(deps))!.id)).filter(({ author }) => author === "system");
    expect(notes).toHaveLength(1);
  });

  it("transfers it even when the draft came in the last step the reply had, with nothing written", async () => {
    const list = { toolCalls: [{ toolName: "listMyTickets", input: { scope: "open" } }] };
    const search = { toolCalls: [{ toolName: "searchArticles", input: { query: "sistema de ponto" } }] };
    const model = scriptedModel([recorded, list, search, list, { toolCalls: [{ toolName: "draftTicket", input: pontoDraft }] }]);
    const deps = await testDeps({ model });
    await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();

    expect(model.calls).toHaveLength(5);
    expect(await conversationRow(deps)).toMatchObject({ state: "waiting_for_analyst", targetLevel: "N2", transferReason: "critical" });
  });

  it("fits a long case in the summary of the analyst", async () => {
    const deps = await testDeps({ model: scriptedModel(draftThenLine({ ...pontoDraft, description: `O sistema de ponto caiu. ${"Ninguém registra o horário. ".repeat(30)}` })) });
    await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();

    const summary = (await conversationRow(deps))?.transferSummary;
    expect(summary).toHaveLength(MAX_TRANSFER_SUMMARY);
    expect(summary?.endsWith("…")).toBe(true);
  });

  it("leaves a case that is not critical with the agent, waiting for her to confirm", async () => {
    const deps = await testDeps({ model: scriptedModel(draftThenLine({ ...pontoDraft, affected: "only_me" })) });
    await readStream(await chat(await post("O sistema de ponto caiu para mim"), deps));
    await deps.settled();

    expect(await conversationRow(deps)).toMatchObject({ state: "with_agent", transferReason: null });
  });

  it("moves nothing when the reply failed after the draft, which is discarded for her to try again", async () => {
    const deps = await testDeps({ model: scriptedModel([recorded, { toolCalls: [{ toolName: "draftTicket", input: pontoDraft }] }, new Error("overloaded")]) });
    await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();

    expect(await conversationRow(deps)).toMatchObject({ state: "with_agent", transferReason: null });
    expect((await deps.db.select({ status: drafts.status }).from(drafts)).map(({ status }) => status)).toEqual(["cancelled"]);
  });

  it("saves the reply and the transfer as one fact: neither when either fails, and both on the retry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = await testDeps({ model: scriptedModel([...draftThenLine(), ...draftThenLine()]) });
    // The real database refuses the note of the transfer, the last statement of the batch.
    await deps.db.run(sql`create trigger no_note before insert on messages when new.author = 'system' begin select raise(abort, 'database down'); end`);
    const text = "O sistema de ponto caiu para toda a empresa";

    await expect(readStream(await chat(await post(text, "msg-ana-1"), deps))).rejects.toThrow("The agent reply was not saved");
    await Promise.allSettled([deps.settled()]);

    const failed = await conversationRow(deps);
    expect(failed).toMatchObject({ state: "with_agent", transferReason: null, firstResponseAt: null });
    // No reply says "Encaminhei" without the transfer, and no card is left without a reply.
    expect((await messagesOf(deps, failed!.id)).map(({ author }) => author)).toEqual(["employee"]);
    expect((await deps.db.select({ status: drafts.status }).from(drafts)).map(({ status }) => status)).toEqual(["cancelled"]);

    await deps.db.run(sql`drop trigger no_note`);
    const again = await chat(await post(text, "msg-ana-1"), deps);
    expect(again.status).toBe(200);
    await readStream(again);
    await deps.settled();

    const row = await conversationRow(deps);
    expect(row).toMatchObject({ state: "waiting_for_analyst", targetLevel: "N2", transferReason: "critical" });
    expect((await messagesOf(deps, row!.id)).map(({ author }) => author)).toEqual(["employee", "agent", "system"]);
    expect((await deps.db.select({ status: drafts.status }).from(drafts)).map(({ status }) => status).sort()).toEqual(["cancelled", "pending"]);
    log.mockRestore();
  });

  it("leaves it with the analyst who assumed it during the reply, without a log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = await testDeps({ model: scriptedModel(draftThenLine()) });
    // The analyst assumes while the tool looks for duplicates.
    vi.spyOn(deps.ticketService, "listCandidates").mockImplementationOnce(async () => {
      await deps.db.update(conversations).set({ state: "with_analyst", analystId: rafael.id }).where(eq(conversations.employeeId, ana.id));
      return { ok: true, data: [] };
    });
    await readStream(await chat(await post("O sistema de ponto caiu para toda a empresa"), deps));
    await deps.settled();

    const row = await conversationRow(deps);
    expect(row).toMatchObject({ state: "with_analyst", analystId: rafael.id, transferReason: null });
    // The reply is saved as any other, and no note says it was transferred.
    expect((await messagesOf(deps, row!.id)).map(({ author }) => author)).toEqual(["employee", "agent"]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
