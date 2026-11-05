import { randomUUID } from "node:crypto";
import { scriptedModel } from "@nexo/agent/testing";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversations, decisions, drafts, messages } from "@/db/schema";
import { chat } from "./chat";
import { loadConversation } from "./conversation";
import { createDraftStore } from "./drafts";
import { createResolutionStore, undoResolution } from "./resolutions";
import { getLoginStats } from "./stats";
import { ana, conversationAt, NOW, readStream, request, sessionCookieFor, testDeps, type TestDeps } from "./test-deps";
import { createTransferStore } from "./transfers";

// The end of a conversation she said is solved: the agent calls markResolved, and the conversation closes in the
// conversations database with the outcome the login screen and the console read.

const decision = { understanding: "Disse que resolveu", action: "Encerrar a conversa", confidence: 0.95, reason: "Ela confirmou." };
const recorded = { toolCalls: [{ toolName: "recordDecision", input: decision }] };
const close = { toolCalls: [{ toolName: "markResolved", input: {} }] };
const solved = "Que bom que resolveu. Se precisar, é só escrever.";
const closingScript = () => [recorded, close, { text: solved }];

const post = async (id: string, text: string) =>
  request("/api/chat", { method: "POST", body: { id, text }, cookie: await sessionCookieFor({ role: "employee", ...ana }) });
const say = async (deps: TestDeps, text: string, id = `msg-${randomUUID()}`) => {
  const response = await chat(await post(id, text), deps);
  const chunks = await readStream(response);
  await deps.settled();
  return chunks;
};

const rowOf = async (deps: TestDeps, id: string) => (await deps.db.select().from(conversations).where(eq(conversations.id, id)))[0]!;
const saved = (deps: TestDeps, id: string) =>
  deps.db
    .select({ author: messages.author, event: messages.event, text: messages.text, parts: messages.parts })
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
const resolvedNotes = (deps: TestDeps, id: string) =>
  deps.db.select().from(messages).where(and(eq(messages.conversationId, id), eq(messages.event, "resolved")));

const draft = (conversationId: string) => ({
  conversationId,
  operation: "create" as const,
  ticketId: null,
  type: "INC" as const,
  title: "VPN não conecta",
  description: "A VPN não conecta desde ontem.",
  category: "network_vpn" as const,
  subcategory: "VPN",
  priority: "medium" as const,
  affected: "only_me" as const,
  impact: "degraded" as const,
  urgency: "none" as const,
  notDuplicateReason: null,
  dueAt: new Date(NOW.getTime() + 60 * 60 * 1000),
  createdAt: NOW,
});

const record = (conversationId: string) => ({ conversationId, turnStartedAt: new Date(NOW.getTime() - 4_000), at: NOW });

describe("markResolved in the chat", () => {
  async function closedConversation() {
    const deps = await testDeps({ model: scriptedModel(closingScript()) });
    await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Reinstale o cliente de VPN." }] });
    await say(deps, "resolveu, obrigado");
    return deps;
  }

  it("closes the conversation with the outcome and the moment, and the reply and its note in order", async () => {
    const deps = await closedConversation();
    expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "closed", outcome: "resolved_by_agent", closedAt: NOW });
    const rows = await saved(deps, "conv-ana");
    expect(rows.slice(-3).map(({ author, event }) => [author, event])).toEqual([
      ["employee", null],
      ["agent", null],
      ["system", "resolved"],
    ]);
    expect(rows.at(-2)?.text).toBe(solved);
    expect(rows.at(-1)?.parts).toEqual([{ type: "data-note", data: { event: "resolved", at: NOW.toISOString() } }]);
  });

  it("saves the tool among those that ran, for the console", async () => {
    const deps = await closedConversation();
    const [decided] = await deps.db
      .select({ toolsUsed: decisions.toolsUsed })
      .from(decisions)
      .innerJoin(messages, eq(messages.id, decisions.messageId))
      .where(and(eq(messages.conversationId, "conv-ana"), eq(messages.text, solved)));
    expect(decided?.toolsUsed).toEqual(["recordDecision", "markResolved"]);
  });

  it("is what the login screen counts as resolved without a queue", async () => {
    const without = await testDeps();
    const deps = await closedConversation();
    const before = (await getLoginStats(without)).resolvedWithoutQueuePercent!;
    expect((await getLoginStats(deps)).resolvedWithoutQueuePercent).toBeGreaterThan(before);
  });

  it("loads closed with its note, and her next message opens a new conversation", async () => {
    const deps = await testDeps({ model: scriptedModel([...closingScript(), recorded, { text: "Oi de novo." }]) });
    await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Reinstale o cliente de VPN." }] });
    await say(deps, "resolveu, obrigado");
    const loaded = await loadConversation(deps, ana.id);
    expect(loaded.conversation).toMatchObject({ id: "conv-ana", state: "closed", limitReached: false });
    expect(loaded.messages.at(-1)).toMatchObject({ role: "system", parts: [{ type: "data-note", data: { event: "resolved" } }] });

    deps.now = () => new Date(NOW.getTime() + 60_000);
    await say(deps, "Outra coisa: a impressora");
    const [open] = await deps.db.select().from(conversations).where(and(eq(conversations.employeeId, ana.id), ne(conversations.state, "closed")));
    expect(open).toMatchObject({ state: "with_agent", messageCount: 1 });
    expect(open?.id).not.toBe("conv-ana");
  });

  it("wins over the limit on the 30th message: it was solved, and only one note says how it ended", async () => {
    const deps = await testDeps({ model: scriptedModel(closingScript()) });
    await conversationAt(deps, { count: 29, lastReply: [{ type: "text", text: "Pronto." }] });
    await say(deps, "resolveu, obrigado");
    expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "closed", outcome: "resolved_by_agent", limitReachedAt: null });
    expect((await saved(deps, "conv-ana")).filter(({ event }) => event !== null).map(({ event }) => event)).toEqual(["resolved"]);
  });

  it("does not close with a draft waiting, and the model hears why", async () => {
    const refusedThenExplained = [recorded, close, { text: "Antes, confirme ou cancele o rascunho no card." }];
    const model = scriptedModel(refusedThenExplained);
    const deps = await testDeps({ model });
    await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Confira antes de eu criar:" }] });
    await createDraftStore(deps.db).save(draft("conv-ana"));
    await say(deps, "resolveu, obrigado");
    expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "with_agent", outcome: null, closedAt: null });
    expect(await resolvedNotes(deps, "conv-ana")).toEqual([]);
    expect(JSON.stringify(model.calls[2]!.prompt)).toContain("draft_pending");
  });

  describe("when the reply fails after closing", () => {
    const failing = () => [recorded, close, new Error("overloaded"), recorded, close, { text: solved }];

    it("gives the conversation back and leaves no note, so nothing counts a reply nobody read", async () => {
      const deps = await testDeps({ model: scriptedModel(failing()) });
      await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Reinstale o cliente de VPN." }] });
      const chunks = await say(deps, "resolveu, obrigado", "msg-solved");
      expect(chunks.at(-1)).toEqual({ type: "finish", finishReason: "error" });
      expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "with_agent", outcome: null, closedAt: null });
      expect(await resolvedNotes(deps, "conv-ana")).toEqual([]);
    });

    it("answers \"Tentar de novo\" in the same conversation, which then closes", async () => {
      const deps = await testDeps({ model: scriptedModel(failing()) });
      await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Reinstale o cliente de VPN." }] });
      await say(deps, "resolveu, obrigado", "msg-solved");
      deps.now = () => new Date(NOW.getTime() + 1_000);
      const again = await chat(await post("msg-solved", "resolveu, obrigado"), deps);
      expect(again.status).toBe(200);
      await readStream(again);
      await deps.settled();
      expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "closed", outcome: "resolved_by_agent", messageCount: 4 });
      expect(await resolvedNotes(deps, "conv-ana")).toHaveLength(1);
      // No empty conversation was left behind by the retry.
      expect(await deps.db.select().from(conversations).where(and(eq(conversations.employeeId, ana.id), ne(conversations.state, "closed")))).toEqual([]);
    });

    it("does nothing for a failed reply that closed nothing", async () => {
      const deps = await testDeps();
      const before = await rowOf(deps, "conv-elisa");
      await undoResolution(deps.db, "conv-elisa", { id: "r1", role: "assistant", parts: [{ type: "text", text: "Oi" }] });
      expect(await rowOf(deps, "conv-elisa")).toEqual(before);
    });

    it("stays closed when she opened another conversation meanwhile: one open per employee", async () => {
      const deps = await testDeps();
      const parts = [
        { type: "tool-markResolved", toolCallId: "c1", state: "output-available", input: {}, output: { ok: true } },
      ] as Parameters<typeof undoResolution>[2]["parts"];
      // Elisa's last conversation ended solved; Bruno's is open. Give it to the same employee as an open one.
      await deps.db.insert(conversations).values({ id: "conv-elisa-new", employeeId: "emp-elisa", state: "with_agent", messageCount: 1, createdAt: NOW });
      await undoResolution(deps.db, "conv-elisa", { id: "r1", role: "assistant", parts });
      expect(await rowOf(deps, "conv-elisa")).toMatchObject({ state: "closed", outcome: "resolved_by_agent" });
    });
  });
});

describe("createResolutionStore", () => {
  it("refuses while a draft waits, and closes once it no longer does", async () => {
    const deps = await testDeps();
    const store = createResolutionStore(deps);
    // Bruno's conversation is with the agent in the sample data.
    const shown = await createDraftStore(deps.db).save(draft("conv-bruno"));
    expect(await store.resolve(record("conv-bruno"))).toEqual({ resolved: false, reason: "draft_pending" });

    await deps.db.update(drafts).set({ status: "cancelled" }).where(eq(drafts.id, shown.id));
    expect(await store.resolve(record("conv-bruno"))).toEqual({ resolved: true });
    expect(await rowOf(deps, "conv-bruno")).toMatchObject({ state: "closed", outcome: "resolved_by_agent", closedAt: NOW });
  });

  it("refuses a draft whose confirmation already started: the ticket may be on its way", async () => {
    const deps = await testDeps();
    const shown = await createDraftStore(deps.db).save(draft("conv-bruno"));
    await deps.db.update(drafts).set({ status: "confirming" }).where(eq(drafts.id, shown.id));
    expect(await createResolutionStore(deps).resolve(record("conv-bruno"))).toEqual({ resolved: false, reason: "draft_pending" });
  });

  it("never closes a conversation an analyst has, or one waiting for an analyst", async () => {
    const deps = await testDeps();
    const store = createResolutionStore(deps);
    // Fábio's conversation is with Rafael in the sample data.
    const before = await rowOf(deps, "conv-fabio");
    expect(await store.resolve(record("conv-fabio"))).toEqual({ resolved: false, reason: "not_with_agent" });
    expect(await rowOf(deps, "conv-fabio")).toEqual(before);
    expect(await resolvedNotes(deps, "conv-fabio")).toEqual([]);
  });

  it("leaves one note when the model asks twice at once", async () => {
    const deps = await testDeps();
    const store = createResolutionStore(deps);
    const answers = await Promise.all([store.resolve(record("conv-bruno")), store.resolve(record("conv-bruno"))]);
    expect(answers).toEqual([{ resolved: true }, { resolved: true }]);
    expect(await resolvedNotes(deps, "conv-bruno")).toHaveLength(1);
  });

  it("loses to a transfer that got there first, by the version it read", async () => {
    const deps = await testDeps();
    const transfer = {
      conversationId: "conv-bruno",
      level: "N1" as const,
      reason: "employee_request" as const,
      summary: "Pediu para falar com um analista sobre a VPN.",
      ticketId: null,
      waitUntil: new Date(NOW.getTime() + 60 * 60 * 1000),
      confidence: 0.9,
      turnStartedAt: NOW,
      at: NOW,
    };
    const [moved, resolved] = await Promise.all([createTransferStore(deps).transfer(transfer), createResolutionStore(deps).resolve(record("conv-bruno"))]);
    const row = await rowOf(deps, "conv-bruno");
    // Whichever won, the conversation is where that one took it and the other said it did not happen.
    if (moved.transferred) {
      expect(resolved).toEqual({ resolved: false, reason: "not_with_agent" });
      expect(row.state).toBe("waiting_for_analyst");
    } else {
      expect(resolved).toEqual({ resolved: true });
      expect(row).toMatchObject({ state: "closed", outcome: "resolved_by_agent" });
    }
  });
});
