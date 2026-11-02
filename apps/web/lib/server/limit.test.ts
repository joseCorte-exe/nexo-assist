import type { NexoUIMessage } from "@nexo/shared";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversations, drafts, messages } from "@/db/schema";
import { applyLimit } from "./limit";
import { ana, conversationAt, NOW, rafael, roundTrips, testDeps, type TestDeps } from "./test-deps";

// The limit of 30 messages (ARQUITETURA.md, section 1): applied by the code right after the 30th is answered. With
// something pending the conversation goes to an analyst; with nothing, it closes; with an analyst already, it stays.

type Parts = NexoUIMessage["parts"];

const plainReply: Parts = [{ type: "text", text: "No Windows 10, reinstale o cliente da VPN." }];
const askingReply: Parts = [
  { type: "text", text: "Não há chamado aberto sobre isso." },
  {
    type: "tool-offerReplies",
    toolCallId: "call-offer",
    state: "output-available",
    input: { question: "Quem está sendo afetado?", options: ["Só eu", "Minha equipe"] },
    output: { ok: true },
  },
];
const overdueLookup: Parts = [
  { type: "text", text: "O INC-20311 está vencido." },
  {
    type: "tool-getTicket",
    toolCallId: "call-get",
    state: "output-available",
    input: { ticketId: "INC-20311" },
    output: { ok: true, ticket: { id: "INC-20311" } },
  } as Parts[number],
];

async function draftFor(deps: TestDeps, conversationId: string, fields: Partial<typeof drafts.$inferInsert> = {}) {
  await deps.db.insert(drafts).values({
    id: "draft-ana",
    number: 900,
    conversationId,
    operation: "create",
    title: "Notebook não liga",
    description: "O notebook não liga desde hoje cedo.",
    type: "INC",
    category: "hardware",
    impact: "stopped",
    urgency: "same_day",
    priority: "high",
    affected: "only_me",
    status: "pending",
    dueAt: NOW,
    createdAt: NOW,
    ...fields,
  });
}

const rowOf = async (deps: TestDeps, id: string) => (await deps.db.select().from(conversations).where(eq(conversations.id, id)))[0]!;
const notesOf = (deps: TestDeps, id: string) =>
  deps.db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, id), eq(messages.event, "limit_reached")))
    .orderBy(asc(messages.createdAt));

describe("applyLimit", () => {
  it("does nothing under 30 messages", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 29, lastReply: plainReply });
    expect(await applyLimit(deps, id)).toEqual({ applied: false });
    expect(await rowOf(deps, id)).toMatchObject({ state: "with_agent", limitReachedAt: null });
  });

  it("closes the conversation at 30 with nothing pending, with one note, and tells the agent", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: plainReply });
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "closed" });

    expect(await rowOf(deps, id)).toMatchObject({ state: "closed", outcome: "limit_reached", closedAt: NOW, limitReachedAt: NOW });
    const [note, ...more] = await notesOf(deps, id);
    expect(more).toEqual([]);
    expect(note).toMatchObject({ author: "system", text: "A conversa chegou ao limite de 30 mensagens e foi encerrada.", createdAt: NOW });
    expect(note?.parts).toEqual([
      { type: "data-note", data: { event: "limit_reached", then: "closed", level: null, analystName: null, at: NOW.toISOString() } },
    ]);
    expect(deps.notes).toEqual(["(atendimento) A conversa chegou ao limite de 30 mensagens e foi encerrada."]);
  });

  it("applies once: a second call, or a second tab, leaves no second note", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: plainReply });
    const [first, second] = await Promise.all([applyLimit(deps, id), applyLimit(deps, id)]);
    expect([first, second]).toContainEqual({ applied: true, then: "closed" });
    expect(await applyLimit(deps, id)).toEqual({ applied: false });
    expect(await notesOf(deps, id)).toHaveLength(1);
  });

  it("sends a draft waiting for confirmation to an analyst, by RN-01 of the draft, with a summary from the agent's notes", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: plainReply });
    await draftFor(deps, id);
    deps.memory.getWorkingMemory = async () => "# Caso\n- Problema: notebook não liga\n- Situação: rascunho montado";
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "transferred" });

    const row = await rowOf(deps, id);
    // Stopped, same day, only her: high priority, which goes to N1 with a wait of 4 business hours.
    expect(row).toMatchObject({
      state: "waiting_for_analyst",
      targetLevel: "N1",
      transferReason: "message_limit",
      transferConfidence: null,
      ticketId: null,
      transferredAt: NOW,
      limitReachedAt: NOW,
      waitUntil: new Date("2026-10-26T17:00:00Z"),
      transferSummary:
        'A conversa chegou ao limite de 30 mensagens com o rascunho "Notebook não liga" esperando confirmação. Problema: notebook não liga. Situação: rascunho montado.',
    });
    // Her 30th message is the first one the analyst has not read.
    expect(row.needsAnalystSince).toEqual((await deps.db.select().from(messages).where(eq(messages.id, "ana-29")))[0]!.createdAt);
    const [note] = await notesOf(deps, id);
    expect(note?.parts?.[0]).toMatchObject({ data: { event: "limit_reached", then: "transferred", level: "N1" } });
  });

  it("sends an open question of the Nexo to an analyst, and the overdue ticket it looked up to N2, marking the ticket", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: overdueLookup.concat(askingReply) });
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "transferred" });

    const row = await rowOf(deps, id);
    expect(row).toMatchObject({ targetLevel: "N2", transferReason: "overdue", ticketId: "INC-20311" });
    const [note] = await notesOf(deps, id);
    // The ticket keeps the line of the transfer, once, under the key of its note.
    expect(deps.ticketService.writes).toEqual([
      {
        method: "POST",
        path: "/tickets/INC-20311/transfer",
        body: { employeeId: ana.id, level: "N2", summary: row.transferSummary },
        key: note!.id,
      },
    ]);
  });

  it("sends her last message, left without an answer, to an analyst", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: null });
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "transferred" });
    expect((await rowOf(deps, id)).transferSummary).toBe(
      "A conversa chegou ao limite de 30 mensagens com a última mensagem do funcionário sem resposta. Leia a conversa para o contexto.",
    );
  });

  it("transfers anyway when the ticket-service is down: the case goes without its ticket", async () => {
    const deps = await testDeps();
    deps.ticketService.setDown(true);
    const id = await conversationAt(deps, { count: 30, lastReply: overdueLookup.concat(askingReply) });
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "transferred" });
    expect(await rowOf(deps, id)).toMatchObject({ state: "waiting_for_analyst", targetLevel: "N1", transferReason: "message_limit", ticketId: null });
  });

  it("leaves a conversation with the analyst who has it, and says who stays", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: plainReply, state: "with_analyst" });
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "analyst" });
    expect(await rowOf(deps, id)).toMatchObject({ state: "with_analyst", analystId: rafael.id, limitReachedAt: NOW });
    const [note] = await notesOf(deps, id);
    expect(note?.parts?.[0]).toMatchObject({ data: { event: "limit_reached", then: "analyst", analystName: "Rafael Lima", level: null } });
  });

  it("leaves a waiting conversation with the level it waits for", async () => {
    // Carla's conversation waits for N1 in the sample data; she reaches 30 while waiting.
    const deps = await testDeps();
    await deps.db.update(conversations).set({ messageCount: 30 }).where(eq(conversations.id, "conv-carla"));
    expect(await applyLimit(deps, "conv-carla")).toEqual({ applied: true, then: "analyst" });
    const [note] = await notesOf(deps, "conv-carla");
    expect(note).toMatchObject({ text: "A conversa chegou ao limite de 30 mensagens e espera o Suporte N1." });
  });

  it("decides again when an analyst takes the conversation while the transfer is being prepared", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: askingReply });
    // Rafael assumes between the read and the write.
    deps.memory.getWorkingMemory = async () => {
      await deps.db
        .update(conversations)
        .set({ state: "with_analyst", analystId: rafael.id, version: 1 })
        .where(eq(conversations.id, id));
      return null;
    };
    expect(await applyLimit(deps, id)).toEqual({ applied: true, then: "analyst" });
    expect(await rowOf(deps, id)).toMatchObject({ state: "with_analyst", transferReason: null, limitReachedAt: NOW });
    expect(await notesOf(deps, id)).toHaveLength(1);
  });

  it("reads what it needs in one round trip and writes in one", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 30, lastReply: plainReply });
    expect(await roundTrips(deps, () => applyLimit(deps, id))).toBe(2);
  });
});
