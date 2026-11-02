import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversations, decisions, messages } from "@/db/schema";
import { chat } from "./chat";
import { loadConversation } from "./conversation";
import { ana, NOW, readStream, request, sessionCookieFor, testDeps, type TestDeps } from "./test-deps";
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
