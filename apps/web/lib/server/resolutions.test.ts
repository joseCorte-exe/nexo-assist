import { randomUUID } from "node:crypto";
import { scriptedModel } from "@nexo/agent/testing";
import type { NexoUIMessage } from "@nexo/shared";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { conversations, decisions, drafts, messages } from "@/db/schema";
import { chat } from "./chat";
import { loadConversation } from "./conversation";
import { applyMove, moves } from "./conversation-moves";
import { createDraftStore } from "./drafts";
import { closeIfResolved, createResolutionStore } from "./resolutions";
import { getLoginStats } from "./stats";
import { ana, conversationAt, NOW, rafael, readStream, request, sessionCookieFor, testDeps, type TestDeps } from "./test-deps";

// The end of a conversation she said is solved: the agent calls markResolved, which only asks, and the conversation closes
// once the reply is saved, with the outcome the login screen and the console read.

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

/** A saved reply that said it was solved, and when its turn started. */
const solvedReply: NexoUIMessage = {
  id: "r1",
  role: "assistant",
  parts: [{ type: "tool-markResolved", toolCallId: "c1", state: "output-available", input: {}, output: { ok: true } }, { type: "text", text: solved }],
};
const closing = (conversationId: string, reply = solvedReply) => ({ conversationId, turnStartedAt: new Date(NOW.getTime() - 4_000), reply });

const withVpnAnswer = (deps: TestDeps, count = 3) => conversationAt(deps, { count, lastReply: [{ type: "text", text: "Reinstale o cliente de VPN." }] });

describe("markResolved in the chat", () => {
  async function closedConversation() {
    const deps = await testDeps({ model: scriptedModel(closingScript()) });
    await withVpnAnswer(deps);
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
    await withVpnAnswer(deps);
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
    const model = scriptedModel([recorded, close, { text: "Antes, confirme ou cancele o rascunho no card." }]);
    const deps = await testDeps({ model });
    await conversationAt(deps, { count: 3, lastReply: [{ type: "text", text: "Confira antes de eu criar:" }] });
    await createDraftStore(deps.db).save(draft("conv-ana"));
    await say(deps, "resolveu, obrigado");
    expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "with_agent", outcome: null, closedAt: null });
    expect(await resolvedNotes(deps, "conv-ana")).toEqual([]);
    expect(JSON.stringify(model.calls[2]!.prompt)).toContain("draft_pending");
  });

  it("stays open with the card live when the same step drafts a ticket and says it was solved", async () => {
    const request = {
      operation: "create",
      title: "Licença do Visio",
      description: "Precisa de uma licença do Visio para o trabalho. Só ele, sem urgência.",
      category: "software",
      impact: "request",
      urgency: "none",
      affected: "only_me",
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = await testDeps({
      model: scriptedModel([
        recorded,
        { toolCalls: [{ toolName: "draftTicket", input: request }, { toolName: "markResolved", input: {} }] },
        { text: "Confira antes de eu criar:" },
      ]),
    });
    await withVpnAnswer(deps);
    await say(deps, "resolveu, e preciso do Visio");
    error.mockRestore();
    expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "with_agent", outcome: null });
    expect(await resolvedNotes(deps, "conv-ana")).toEqual([]);
    const [shown] = await deps.db.select({ status: drafts.status }).from(drafts).where(eq(drafts.conversationId, "conv-ana"));
    expect(shown?.status).toBe("pending");
  });

  describe("when the reply fails after the tool answered", () => {
    const failing = () => [recorded, close, new Error("overloaded"), recorded, close, { text: solved }];

    it("closes nothing and leaves no note: nothing counts a reply nobody read", async () => {
      const deps = await testDeps({ model: scriptedModel(failing()) });
      await withVpnAnswer(deps);
      const chunks = await say(deps, "resolveu, obrigado", "msg-solved");
      expect(chunks.at(-1)).toEqual({ type: "finish", finishReason: "error" });
      expect(await rowOf(deps, "conv-ana")).toMatchObject({ state: "with_agent", outcome: null, closedAt: null });
      expect(await resolvedNotes(deps, "conv-ana")).toEqual([]);
    });

    it("answers \"Tentar de novo\" in the same conversation, which then closes", async () => {
      const deps = await testDeps({ model: scriptedModel(failing()) });
      await withVpnAnswer(deps);
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
  });
});

describe("createResolutionStore", () => {
  it("answers whether the conversation can end, and moves nothing", async () => {
    const deps = await testDeps();
    // Bruno's conversation is with the agent in the sample data.
    const before = await rowOf(deps, "conv-bruno");
    expect(await createResolutionStore(deps.db).check("conv-bruno")).toBeNull();
    expect(await rowOf(deps, "conv-bruno")).toEqual(before);
    expect(await resolvedNotes(deps, "conv-bruno")).toEqual([]);
  });

  it("refuses while a draft waits, its confirmation under way included, and not once it no longer does", async () => {
    const deps = await testDeps();
    const store = createResolutionStore(deps.db);
    const shown = await createDraftStore(deps.db).save(draft("conv-bruno"));
    expect(await store.check("conv-bruno")).toBe("draft_pending");

    await deps.db.update(drafts).set({ status: "confirming" }).where(eq(drafts.id, shown.id));
    expect(await store.check("conv-bruno")).toBe("draft_pending");

    await deps.db.update(drafts).set({ status: "cancelled" }).where(eq(drafts.id, shown.id));
    expect(await store.check("conv-bruno")).toBeNull();
  });

  it("refuses a conversation an analyst has", async () => {
    const deps = await testDeps();
    // Fábio's conversation is with Rafael in the sample data.
    expect(await createResolutionStore(deps.db).check("conv-fabio")).toBe("not_with_agent");
  });
});

describe("closeIfResolved", () => {
  it("closes the conversation of a reply that said it was solved", async () => {
    const deps = await testDeps();
    await closeIfResolved(deps, closing("conv-bruno"));
    expect(await rowOf(deps, "conv-bruno")).toMatchObject({ state: "closed", outcome: "resolved_by_agent", closedAt: NOW });
    expect(await resolvedNotes(deps, "conv-bruno")).toHaveLength(1);
  });

  it("does nothing for a reply that did not say so", async () => {
    const deps = await testDeps();
    const before = await rowOf(deps, "conv-bruno");
    await closeIfResolved(deps, closing("conv-bruno", { id: "r2", role: "assistant", parts: [{ type: "text", text: "Oi" }] }));
    await closeIfResolved(
      deps,
      closing("conv-bruno", {
        id: "r3",
        role: "assistant",
        parts: [{ type: "tool-markResolved", toolCallId: "c1", state: "output-available", input: {}, output: { ok: false, reason: "draft_pending", message: "?" } }],
      }),
    );
    expect(await rowOf(deps, "conv-bruno")).toEqual(before);
  });

  it("sees a draft saved after the tool answered: the conversation stays open and the card live, and it logs why", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = await testDeps();
    await createDraftStore(deps.db).save(draft("conv-bruno"));
    await closeIfResolved(deps, closing("conv-bruno"));
    expect(error).toHaveBeenCalledWith("reply said solved but the conversation stays open", { conversationId: "conv-bruno", reason: "draft_pending" });
    error.mockRestore();
    expect(await rowOf(deps, "conv-bruno")).toMatchObject({ state: "with_agent", outcome: null });
    const [shown] = await deps.db.select({ status: drafts.status }).from(drafts).where(eq(drafts.conversationId, "conv-bruno"));
    expect(shown?.status).toBe("pending");
  });

  it("leaves it with an analyst who assumed after the tool answered, and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = await testDeps();
    await applyMove(deps, "conv-bruno", moves.assume(rafael), NOW);
    const before = await rowOf(deps, "conv-bruno");
    await closeIfResolved(deps, closing("conv-bruno"));
    expect(error).toHaveBeenCalledWith("reply said solved but the conversation stays open", { conversationId: "conv-bruno", reason: "not_with_agent" });
    error.mockRestore();
    expect(await rowOf(deps, "conv-bruno")).toEqual(before);
    expect(await resolvedNotes(deps, "conv-bruno")).toEqual([]);
  });
});

describe("the sample data", () => {
  it("ends Elisa's conversation as a real one ends: her words, the closing sentence, then the note", async () => {
    const deps = await testDeps();
    const rows = await saved(deps, "conv-elisa");
    expect(rows.slice(-3).map(({ author, event }) => [author, event])).toEqual([
      ["employee", null],
      ["agent", null],
      ["system", "resolved"],
    ]);
    const loaded = await loadConversation(deps, "emp-elisa");
    expect(loaded.messages.at(-1)).toMatchObject({ role: "system", parts: [{ type: "data-note", data: { event: "resolved" } }] });
  });
});
