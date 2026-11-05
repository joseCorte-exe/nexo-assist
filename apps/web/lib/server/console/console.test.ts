import { randomUUID } from "node:crypto";
import type { ConsoleDetail, ConsoleListResponse, EmployeeTicketsPanel } from "@nexo/shared";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { conversations, messages } from "@/db/schema";
import { chat } from "../chat";
import { conversationHandler, loadConversation } from "../conversation";
import { presenceHandler } from "../presence";
import { createTransferStore } from "../transfers";
import { ana, conversationAt, fakeTicketService, NOW, rafael, readStream, request, roundTrips, sessionCookieFor, testDeps, type TestDeps } from "../test-deps";
import { assumeHandler, closeHandler, messageHandler, readHandler, releaseHandler } from "./actions";
import { availabilityHandler } from "./availability";
import { detailHandler } from "./detail";
import { listHandler } from "./list";
import { ticketsPanelHandler } from "./panel";

// The console of feature 5, through its route handlers. The sample data has a conversation in each state: Diego waiting
// for N2 (critical, INC-20319), Carla waiting for N1 (the agent asked for help), Fábio with Rafael, Bruno with the agent,
// Elisa and Gabriela closed. Ana starts without one and transfers through the chat, as she would.

const juliana = { id: "analyst-juliana", name: "Juliana Costa", email: "juliana.costa@nexo.com.br" };
const rafaelCookie = () => sessionCookieFor({ role: "analyst", ...rafael });
const julianaCookie = () => sessionCookieFor({ role: "analyst", ...juliana });
const anaCookie = () => sessionCookieFor({ role: "employee", ...ana });

async function list(deps: TestDeps, query = "", cookie?: string) {
  const response = await listHandler(request(`/api/console/conversations${query}`, { cookie: cookie ?? (await rafaelCookie()) }), deps);
  expect(response.status).toBe(200);
  return (await response.json()) as ConsoleListResponse;
}

async function detail(deps: TestDeps, id: string, cookie?: string) {
  const response = await detailHandler(request(`/api/console/conversations/${id}`, { cookie: cookie ?? (await rafaelCookie()) }), deps, id);
  return { status: response.status, body: (await response.json()) as ConsoleDetail };
}

type Action = typeof assumeHandler;
async function act(deps: TestDeps, action: Action, id: string, cookie?: string) {
  const response = await action(request(`/api/console/conversations/${id}/x`, { method: "POST", cookie: cookie ?? (await rafaelCookie()) }), deps, id);
  return { status: response.status, body: (await response.json()) as ConsoleDetail & { error?: { code: string; message: string } } };
}

async function write(deps: TestDeps, id: string, text: string, messageId = `msg-${randomUUID()}`, cookie?: string) {
  const response = await messageHandler(
    request(`/api/console/conversations/${id}/messages`, { method: "POST", body: { id: messageId, text }, cookie: cookie ?? (await rafaelCookie()) }),
    deps,
    id,
  );
  return { status: response.status, body: await response.json() };
}

async function anaSays(deps: TestDeps, text: string) {
  const cookie = await anaCookie();
  await readStream(await chat(request("/api/chat", { method: "POST", body: { id: `msg-${randomUUID()}`, text }, cookie }), deps));
  await deps.settled();
}

/** A minute after NOW: when Ana asks for an analyst, and the clock of what follows. */
const LATER = new Date(NOW.getTime() + 60_000);
const after = (ms: number) => new Date(LATER.getTime() + ms);

/**
 * Ana looks her overdue ticket up and, a minute later, asks for an analyst: the conversation goes to N2, Rafael's level.
 * The clock moves between the two, as it does for her, so the order of the messages is the real one.
 */
async function anaTransferred(deps: TestDeps) {
  deps.now = () => NOW;
  await anaSays(deps, "INC-20311 · Notebook lento após atualização do Windows");
  deps.now = () => LATER;
  await anaSays(deps, "Falar com um analista");
  // The analyst acts a few seconds after the reply that transferred her.
  deps.now = () => after(5_000);
  const [row] = await deps.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.employeeId, ana.id), ne(conversations.state, "closed")));
  return row!;
}

const ids = (response: ConsoleListResponse) => response.conversations.map((conversation) => conversation.id);

describe("GET /api/console/conversations", () => {
  it("answers 401 without a session and 403 for an employee", async () => {
    const deps = await testDeps();
    expect((await listHandler(request("/api/console/conversations"), deps)).status).toBe(401);
    expect((await listHandler(request("/api/console/conversations", { cookie: await anaCookie() }), deps)).status).toBe(403);
  });

  it("lists every conversation, the most recent activity first, with the counts of the chips and the waiting ones", async () => {
    const deps = await testDeps();
    const all = await list(deps);
    expect(ids(all).slice(0, 4)).toEqual(["conv-bruno", "conv-carla", "conv-diego", "conv-fabio"]);
    expect(ids(all)).toContain("conv-elisa");
    // Rafael is N2: Diego waits for N2, Bruno is with the agent, Fábio is his.
    expect(all.counts).toEqual({ forYou: 1, withAgent: 1, mine: 1 });
    expect(all.waiting).toBe(2);
  });

  it("describes each conversation with the employee's name and department, the transfer and the last message", async () => {
    const deps = await testDeps();
    const diego = (await list(deps)).conversations.find((conversation) => conversation.id === "conv-diego");
    expect(diego).toMatchObject({
      employee: { id: "emp-diego", name: "Diego Ramos", department: "Operações" },
      state: "waiting_for_analyst",
      targetLevel: "N2",
      transferReason: "critical",
      ticketId: "INC-20319",
      analyst: null,
      preview: { author: "agent", text: expect.stringContaining("INC-20319"), seen: false },
      online: false,
      typing: false,
    });
    const fabio = (await list(deps)).conversations.find((conversation) => conversation.id === "conv-fabio");
    expect(fabio?.analyst).toEqual({ id: "analyst-rafael", name: "Rafael Lima", level: "N2" });
    expect(fabio?.preview?.author).toBe("analyst");
  });

  it("filters what waits at the level of who is signed in, what the agent attends and what is theirs", async () => {
    const deps = await testDeps();
    expect(ids(await list(deps, "?filter=for_you"))).toEqual(["conv-diego"]);
    expect(ids(await list(deps, "?filter=for_you", await julianaCookie()))).toEqual(["conv-carla"]);
    expect(ids(await list(deps, "?filter=with_agent"))).toEqual(["conv-bruno"]);
    expect(ids(await list(deps, "?filter=mine"))).toEqual(["conv-fabio"]);
    expect(ids(await list(deps, "?filter=mine", await julianaCookie()))).toEqual([]);
  });

  it("searches by the name of the employee or the number of the ticket", async () => {
    const deps = await testDeps();
    // Her conversation now, then the closed ones of the last weeks.
    const carla = await list(deps, "?search=carla");
    expect(ids(carla)[0]).toBe("conv-carla");
    expect(new Set(carla.conversations.map((conversation) => conversation.employee.id))).toEqual(new Set(["emp-carla"]));
    expect(ids(await list(deps, "?search=inc-20319"))).toEqual(["conv-diego"]);
    expect(ids(await list(deps, "?search=ninguem"))).toEqual([]);
  });

  it("refuses an unknown filter", async () => {
    const deps = await testDeps();
    const response = await listHandler(request("/api/console/conversations?filter=everything", { cookie: await rafaelCookie() }), deps);
    expect(response.status).toBe(400);
  });

  it("puts a transferred conversation in the queue of its level, with what she wrote since the agent last answered as unread", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    const forYou = await list(deps, "?filter=for_you");
    expect(ids(forYou)).toEqual([conversation.id, "conv-diego"]);
    expect(forYou.conversations[0]).toMatchObject({ transferReason: "overdue", ticketId: "INC-20311", unread: 1 });
    expect(forYou.counts.forYou).toBe(2);
  });

  it("counts as unread what she writes after the analyst read the conversation", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    const read = await readHandler(request("/x", { method: "POST", cookie: await rafaelCookie() }), deps, conversation.id);
    expect(read.status).toBe(204);
    expect((await list(deps, "?filter=for_you")).conversations[0]?.unread).toBe(0);
    deps.now = () => after(60_000);
    await anaSays(deps, "Alguma novidade?");
    expect((await list(deps, "?filter=for_you")).conversations[0]?.unread).toBe(1);
    // Read by Rafael only: Juliana has not read it.
    expect((await list(deps, "", await julianaCookie())).conversations.find((one) => one.id === conversation.id)?.unread).toBe(2);
  });

  it("counts a second transfer from where it started again, not from a read of the first one", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    await readHandler(request("/x", { method: "POST", cookie: await rafaelCookie() }), deps, conversation.id);
    await act(deps, releaseHandler, conversation.id);
    deps.now = () => after(60_000);
    await anaSays(deps, "Qual o horário do service desk?");
    deps.now = () => after(120_000);
    await anaSays(deps, "Quero falar com um analista.");
    // An N1 transfer this time: it is in Todas.
    const [line] = (await list(deps)).conversations.filter((one) => one.id === conversation.id);
    // Only what led to the second transfer: her last message, after the agent's last answer.
    expect(line?.unread).toBe(1);
  });

  it("shows who has the chat open, and who is writing", async () => {
    const deps = await testDeps();
    await anaTransferred(deps);
    const ping = (typing: boolean) => presenceHandler(request("/api/conversation/presence", { method: "POST", body: { typing }, cookie: undefined }), deps);
    expect((await ping(false)).status).toBe(401);
    const cookie = await anaCookie();
    // She reads the reply that transferred her and starts writing.
    deps.now = () => after(1_000);
    const response = await presenceHandler(request("/api/conversation/presence", { method: "POST", body: { typing: true }, cookie }), deps);
    expect(await response.json()).toMatchObject({ conversation: { state: "waiting_for_analyst" } });
    const [line] = (await list(deps, "?filter=for_you")).conversations;
    expect(line).toMatchObject({ online: true, typing: true, preview: { seen: true } });
    deps.now = () => after(10_000);
    expect((await list(deps, "?filter=for_you")).conversations[0]).toMatchObject({ online: true, typing: false });
    deps.now = () => after(60_000);
    expect((await list(deps, "?filter=for_you")).conversations[0]).toMatchObject({ online: false });
  });

  it("reads the page in a fixed number of round trips, whatever its size", async () => {
    const deps = await testDeps();
    await list(deps);
    // The counts and the page in one batch; names come from the ticket-service, cached.
    expect(await roundTrips(deps, () => list(deps))).toBe(1);
  });
});

describe("GET /api/console/conversations/:id", () => {
  it("answers the history with the notes, the decisions and who wrote each analyst message", async () => {
    const deps = await testDeps();
    const { status, body } = await detail(deps, "conv-fabio");
    expect(status).toBe(200);
    expect(body.conversation).toMatchObject({ id: "conv-fabio", state: "with_analyst", ticketId: "INC-20302", transferSummary: expect.any(String) });
    const authors = body.messages.map((message) => message.author);
    expect(authors).toEqual(["employee", "agent", "employee", "agent", "system", "system", "analyst"]);
    const [, firstReply] = body.messages;
    expect(firstReply?.decision).toMatchObject({ record: { confidence: 0.86 }, toolsUsed: ["recordDecision", "searchArticles", "draftTicket"] });
    expect(body.messages[5]?.note).toEqual({ event: "assumed", level: "N2", analystName: "Rafael Lima" });
    expect(body.messages[6]?.analyst).toEqual({ id: "analyst-rafael", name: "Rafael Lima", level: "N2" });
  });

  it("shows a reply that was only a card and an offer by what it asked, never as an empty bubble", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    const { body } = await detail(deps, conversation.id);
    const offer = body.messages.find((message) => message.author === "agent" && message.text.includes("Quer que eu chame um analista?"));
    expect(offer?.text).toMatch(/^Chamado INC-20311 · Notebook lento após atualização do Windows\nEstá sem atualização há \d+ dias/);
    expect(body.messages.filter((message) => message.author === "agent").every((message) => message.text.trim() !== "")).toBe(true);
  });

  it("answers 404 for a conversation that does not exist", async () => {
    const deps = await testDeps();
    expect((await detail(deps, "conv-nobody")).status).toBe(404);
  });
});

describe("assume, release and close", () => {
  it("assumes a waiting conversation: the agent pauses, the note says who, the memory knows, the ticket is in service", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    const { status, body } = await act(deps, assumeHandler, conversation.id);
    expect(status).toBe(200);
    expect(body.conversation).toMatchObject({ state: "with_analyst", analyst: { id: "analyst-rafael" }, assumedAt: after(5_000).toISOString() });
    const note = body.messages.at(-1);
    expect(note).toMatchObject({ author: "system", note: { event: "assumed", analystName: "Rafael Lima" } });
    expect(deps.notes.at(-1)).toBe("(atendimento) Rafael Lima, analista do Suporte N2, assumiu a conversa. O agent está pausado até a conversa voltar para ele.");
    expect(deps.ticketService.writes.at(-1)).toEqual({
      method: "POST",
      path: "/tickets/INC-20311/assign",
      body: { employeeId: ana.id, analystId: "analyst-rafael" },
      key: note!.id,
    });
  });

  it("puts in service the ticket the agent linked while the analyst was assuming", async () => {
    const deps = await testDeps();
    await anaSays(deps, "Qual o horário do service desk?");
    const [conversation] = await deps.db.select().from(conversations).where(eq(conversations.employeeId, ana.id));
    // The analyst read it with the agent and no ticket; the agent transfers it, about INC-20311, right before the move.
    const batch = deps.db.batch.bind(deps.db);
    let raced = false;
    deps.db.batch = (async (queries: Parameters<typeof batch>[0]) => {
      if (!raced) {
        raced = true;
        await createTransferStore(deps).transfer({
          conversationId: conversation!.id,
          level: "N2",
          reason: "overdue",
          summary: "Notebook lento e o INC-20311 vencido.",
          ticketId: "INC-20311",
          waitUntil: LATER,
          confidence: null,
          turnStartedAt: NOW,
          at: NOW,
        });
      }
      return batch(queries);
    }) as unknown as typeof deps.db.batch;
    const { body } = await act(deps, assumeHandler, conversation!.id);
    expect(body.conversation).toMatchObject({ state: "with_analyst", ticketId: "INC-20311" });
    expect(deps.ticketService.writes.at(-1)).toMatchObject({ path: "/tickets/INC-20311/assign" });
  });

  it("assumes once when clicked twice", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    const [first, second] = await Promise.all([act(deps, assumeHandler, conversation.id), act(deps, assumeHandler, conversation.id)]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const assumed = await deps.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.event, "assumed")));
    expect(assumed).toHaveLength(1);
  });

  it("does not take a conversation another analyst is attending", async () => {
    const deps = await testDeps();
    const { status, body } = await act(deps, assumeHandler, "conv-fabio", await julianaCookie());
    expect(status).toBe(409);
    expect(body.error).toEqual({ code: "assumed_by_other", message: "Rafael Lima já está atendendo esta conversa." });
  });

  it("lets an analyst take a conversation the agent is attending", async () => {
    const deps = await testDeps();
    const { body } = await act(deps, assumeHandler, "conv-bruno");
    expect(body.conversation.state).toBe("with_analyst");
  });

  it("releases an assumed conversation to the agent, which answers her again", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    await act(deps, assumeHandler, conversation.id);
    const { status, body } = await act(deps, releaseHandler, conversation.id);
    expect(status).toBe(200);
    expect(body.conversation).toMatchObject({ state: "with_agent", analyst: null, waitUntil: null });
    expect(body.messages.at(-1)?.note).toEqual({ event: "released", analystName: "Rafael Lima" });
    expect(deps.notes.at(-1)).toBe("(atendimento) Rafael Lima devolveu a conversa para o agent.");
    deps.now = () => after(60_000);
    await anaSays(deps, "Qual o horário do service desk?");
    const loaded = await loadConversation(deps, ana.id);
    expect(loaded.messages.at(-1)?.role).toBe("assistant");
  });

  it("releases a waiting conversation nobody assumed, and refuses to release somebody else's", async () => {
    const deps = await testDeps();
    expect((await act(deps, releaseHandler, "conv-diego")).body.conversation.state).toBe("with_agent");
    const refused = await act(deps, releaseHandler, "conv-fabio", await julianaCookie());
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("assumed_by_other");
  });

  it("refuses to release a conversation the limit left with an analyst, and says so in the detail", async () => {
    // Fábio is with Rafael in the sample data; he reaches the limit.
    const deps = await testDeps();
    await deps.db.update(conversations).set({ messageCount: 30, limitReachedAt: NOW }).where(eq(conversations.id, "conv-fabio"));
    const refused = await act(deps, releaseHandler, "conv-fabio");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toEqual({
      code: "limit_reached",
      message: "Esta conversa chegou ao limite de mensagens e não volta para o agent. Encerre quando terminar.",
    });
    const { body } = await act(deps, closeHandler, "conv-fabio");
    expect(body.conversation).toMatchObject({ state: "closed", limitReached: true });
  });

  it("closes an assumed conversation as closed by the analyst, without touching the ticket", async () => {
    const deps = await testDeps();
    const writesBefore = deps.ticketService.writes.length;
    const { status, body } = await act(deps, closeHandler, "conv-fabio");
    expect(status).toBe(200);
    expect(body.conversation).toMatchObject({ state: "closed", outcome: "closed_by_analyst", analyst: { id: "analyst-rafael" } });
    expect(body.messages.at(-1)?.note).toEqual({ event: "closed", analystName: "Rafael Lima" });
    expect(deps.ticketService.writes).toHaveLength(writesBefore);
  });

  it("only closes a conversation the analyst assumed", async () => {
    const deps = await testDeps();
    const waiting = await act(deps, closeHandler, "conv-diego");
    expect(waiting.status).toBe(409);
    expect(waiting.body.error).toEqual({ code: "not_assumed", message: "Assuma o atendimento antes." });
    expect((await act(deps, closeHandler, "conv-fabio", await julianaCookie())).status).toBe(409);
  });
});

describe("POST /api/console/conversations/:id/messages", () => {
  it("saves the analyst's message under its id, copies it to the memory and shows it in her chat", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    await act(deps, assumeHandler, conversation.id);
    const text = "Oi, Ana! Aqui é o Rafael. Pode deixar o notebook ligado agora?";
    const { status, body } = await write(deps, conversation.id, text, "msg-rafael-1");
    expect(status).toBe(201);
    expect(body).toMatchObject({ id: "msg-rafael-1", author: "analyst", text, analyst: { name: "Rafael Lima", level: "N2" } });
    expect(deps.notes.at(-1)).toBe(`(atendimento) Rafael Lima, analista do Suporte N2, escreveu: "${text}"`);
    const chat = await loadConversation(deps, ana.id);
    expect(chat.conversation?.analyst).toEqual({ name: "Rafael Lima", level: "N2" });
    expect(chat.messages.at(-1)).toMatchObject({
      id: "msg-rafael-1",
      role: "assistant",
      parts: [{ type: "data-analyst", data: { name: "Rafael Lima", level: "N2" } }, { type: "text", text }],
    });
  });

  it("does not save a message sent again twice", async () => {
    const deps = await testDeps();
    await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-2");
    const again = await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-2");
    expect(again.status).toBe(201);
    const saved = await deps.db.select().from(messages).where(eq(messages.id, "msg-rafael-2"));
    expect(saved).toHaveLength(1);
  });

  it("answers a message sent again as sent, even after the conversation moved on", async () => {
    const deps = await testDeps();
    await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-3");
    // The response was lost; meanwhile Rafael closed the service, and the console tries again.
    await act(deps, closeHandler, "conv-fabio");
    const again = await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-3");
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ id: "msg-rafael-3", author: "analyst", text: "Consegue testar agora?" });
    expect(await deps.db.select().from(messages).where(eq(messages.id, "msg-rafael-3"))).toHaveLength(1);
  });

  it("refuses a message in a conversation the analyst has not assumed", async () => {
    const deps = await testDeps();
    const waiting = await write(deps, "conv-diego", "Oi, Diego.");
    expect(waiting.status).toBe(409);
    expect(waiting.body).toEqual({ error: { code: "not_assumed", message: "Assuma o atendimento antes." } });
    // Fábio's conversation is with Rafael: she is told who has it.
    const taken = await write(deps, "conv-fabio", "Oi, Fábio.", undefined, await julianaCookie());
    expect(taken.status).toBe(409);
    expect(taken.body).toEqual({ error: { code: "assumed_by_other", message: "Rafael Lima já está atendendo esta conversa." } });
  });

  it("never writes past a move made between reading the conversation and writing the message", async () => {
    const deps = await testDeps();
    const batch = deps.db.batch.bind(deps.db);
    let calls = 0;
    deps.db.batch = (async (queries: Parameters<typeof batch>[0]) => {
      // The first batch reads the conversation; before the second one writes the message, Rafael hands Fábio back to
      // the agent and takes him again: the same state, a newer version.
      if (++calls === 2) {
        deps.db.batch = batch;
        await act(deps, releaseHandler, "conv-fabio");
        await act(deps, assumeHandler, "conv-fabio");
      }
      return batch(queries);
    }) as unknown as typeof deps.db.batch;
    const sent = await write(deps, "conv-fabio", "Oi, Fábio.");
    expect(sent.status).toBe(409);
    expect(sent.body.error.code).toBe("conversation_busy");
  });

  it("refuses an empty message", async () => {
    const deps = await testDeps();
    expect((await write(deps, "conv-fabio", "   ")).status).toBe(400);
  });
});

describe("the message of the analyst on the linked ticket (RN-02)", () => {
  /** The answers the ticket-service received, once the work left for after the response ended. */
  async function answers(deps: TestDeps) {
    await deps.settled();
    return deps.ticketService.writes.filter((one) => one.path.endsWith("/answer"));
  }

  it("notes the answer on the ticket of the conversation, with the message as the key", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    await act(deps, assumeHandler, conversation.id);
    await write(deps, conversation.id, "Pode deixar o notebook ligado agora?", "msg-rafael-1");
    expect(await answers(deps)).toEqual([
      {
        method: "POST",
        path: "/tickets/INC-20311/answer",
        body: { employeeId: ana.id, text: "Pode deixar o notebook ligado agora?" },
        key: "msg-rafael-1",
      },
    ]);
  });

  it("notes a message sent again once", async () => {
    const deps = await testDeps();
    await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-2");
    await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-2");
    expect(await answers(deps)).toHaveLength(1);
  });

  it("makes no call for a conversation without a linked ticket", async () => {
    const deps = await testDeps();
    const id = await conversationAt(deps, { count: 1, lastReply: null, state: "with_analyst" });
    expect((await write(deps, id, "Oi, Ana.")).status).toBe(201);
    expect(await answers(deps)).toEqual([]);
  });

  it("does not count assuming, releasing, closing, her message or a refused one", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    expect((await write(deps, conversation.id, "Ainda não assumi.")).status).toBe(409);
    await act(deps, assumeHandler, conversation.id);
    await anaSays(deps, "Está ligado.");
    await act(deps, releaseHandler, conversation.id);
    await act(deps, assumeHandler, conversation.id);
    await act(deps, closeHandler, conversation.id);
    expect(await answers(deps)).toEqual([]);
  });

  it("keeps the message and logs without its text when the ticket-service is down for writes; the next one gets through", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = await testDeps({ ticketService: fakeTicketService({ writesDown: true }) });
      const secret = "A senha temporária é Nexo1234";
      const sent = await write(deps, "conv-fabio", secret, "msg-rafael-4");
      expect(sent.status).toBe(201);
      expect(await answers(deps)).toEqual([]);
      expect(await deps.db.select().from(messages).where(eq(messages.id, "msg-rafael-4"))).toHaveLength(1);
      expect(deps.notes.at(-1)).toContain(secret);
      expect(errors).toHaveBeenCalledWith("analyst answer not noted on the ticket", {
        ticketId: "INC-20302",
        messageId: "msg-rafael-4",
        error: "unavailable",
      });
      expect(JSON.stringify(errors.mock.calls)).not.toContain(secret);

      deps.ticketService.setWritesDown(false);
      await write(deps, "conv-fabio", "Consegue testar agora?", "msg-rafael-5");
      expect((await answers(deps)).map((one) => one.key)).toEqual(["msg-rafael-5"]);
    } finally {
      errors.mockRestore();
    }
  });

  it("refuses without saving when the analysts cannot be read, so the console can send it again", async () => {
    const deps = await testDeps();
    deps.ticketService.setDown(true);
    const sent = await write(deps, "conv-fabio", "Oi, Fábio.", "msg-rafael-8");
    expect(sent.status).toBe(503);
    expect(await deps.db.select().from(messages).where(eq(messages.id, "msg-rafael-8"))).toEqual([]);
    deps.ticketService.setDown(false);
    expect((await write(deps, "conv-fabio", "Oi, Fábio.", "msg-rafael-8")).status).toBe(201);
  });

  it("does not restart a resolved ticket, and it is no failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = await testDeps();
      const id = await conversationAt(deps, { count: 1, lastReply: null, state: "with_analyst" });
      await deps.db.update(conversations).set({ ticketId: "INC-20150" }).where(eq(conversations.id, id));
      expect((await write(deps, id, "Vi que já foi resolvido.")).status).toBe(201);
      expect((await answers(deps)).map((one) => one.path)).toEqual(["/tickets/INC-20150/answer"]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe("GET /api/console/employees/:id/tickets", () => {
  it("lists every ticket of the employee, the open ones first, with the counts of the header", async () => {
    const deps = await testDeps();
    const response = await ticketsPanelHandler(request("/x", { cookie: await rafaelCookie() }), deps, "emp-ana");
    expect(response.status).toBe(200);
    const panel = (await response.json()) as EmployeeTicketsPanel;
    expect(panel.employee).toEqual({ id: "emp-ana", name: "Ana Souza" });
    expect([panel.open, panel.closed]).toEqual([3, 2]);
    expect(panel.tickets.map((ticket) => ticket.id)).toEqual(["INC-20311", "INC-20298", "REQ-10442", "INC-20150", "INC-19877"]);
  });

  it("is only for analysts", async () => {
    const deps = await testDeps();
    expect((await ticketsPanelHandler(request("/x", { cookie: await anaCookie() }), deps, "emp-ana")).status).toBe(403);
  });

  it("answers 503 when the ticket-service is down", async () => {
    const deps = await testDeps();
    deps.ticketService.setDown(true);
    expect((await ticketsPanelHandler(request("/x", { cookie: await rafaelCookie() }), deps, "emp-ana")).status).toBe(503);
  });
});

describe("PATCH /api/console/me", () => {
  it("sets whether the analyst is available, in the ticket-service", async () => {
    const deps = await testDeps();
    const response = await availabilityHandler(request("/api/console/me", { method: "PATCH", body: { available: false }, cookie: await rafaelCookie() }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "analyst-rafael", available: false });
    expect(deps.ticketService.writes.at(-1)).toMatchObject({ method: "PATCH", path: "/analysts/analyst-rafael", body: { available: false } });
  });

  it("is only for analysts", async () => {
    const deps = await testDeps();
    const response = await availabilityHandler(request("/api/console/me", { method: "PATCH", body: { available: false }, cookie: await anaCookie() }), deps);
    expect(response.status).toBe(403);
  });
});

describe("the chat of the employee after the console acted", () => {
  it("still shows a conversation the analyst closed, when the chat asks for it by id", async () => {
    const deps = await testDeps();
    const conversation = await anaTransferred(deps);
    await act(deps, assumeHandler, conversation.id);
    await act(deps, closeHandler, conversation.id);
    const cookie = await anaCookie();
    const shown = await conversationHandler(request(`/api/conversation?conversationId=${conversation.id}`, { cookie }), deps);
    expect(await shown.json()).toMatchObject({ conversation: { id: conversation.id, state: "closed" } });
    // Without the id too, as the last one that ended (feature 6): the next message starts a new one.
    expect(await (await conversationHandler(request("/api/conversation", { cookie }), deps)).json()).toMatchObject({
      conversation: { id: conversation.id, state: "closed" },
    });
  });

  it("never shows somebody else's conversation by id", async () => {
    const deps = await testDeps();
    const response = await conversationHandler(request("/api/conversation?conversationId=conv-carla", { cookie: await anaCookie() }), deps);
    expect(await response.json()).toEqual({ conversation: null, messages: [], drafts: [] });
  });
});
