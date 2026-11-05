import { randomUUID } from "node:crypto";
import { toAISdkStream } from "@mastra/ai-sdk";
import { rememberNote, RESUME_NOTE, resumeNote, streamReply } from "@nexo/agent";
import {
  chatInput,
  type ConversationView,
  isPaused,
  MESSAGE_LIMIT,
  type NexoUIMessage,
  reachedLimit,
  replyText,
  shownDraft,
  summarizeTurn,
  withToolErrors,
} from "@nexo/shared";
import { consumeStream, createUIMessageStream, createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type { Db } from "@/db";
import { conversations, decisions, drafts, messages } from "@/db/schema";
import { activeConversationOf, toConversationView, viewColumns } from "./conversation";
import type { Deps } from "./deps";
import { jsonError, readBody, readEmployeeSession } from "./http";
import { applyLimit } from "./limit";
import { replyPlace } from "./messages";
import { closeIfResolved } from "./resolutions";

const AGENT_FAILED = "O Nexo não conseguiu responder. Tente de novo.";

const REFUSALS = {
  already_answered: { code: "already_answered", message: "Essa mensagem já foi respondida." },
  message_conflict: { code: "message_conflict", message: "Essa mensagem já foi enviada." },
  limit_due: { code: "conversation_busy", message: "A conversa acabou de mudar. Tente de novo." },
};

/**
 * paused: the conversation is with an analyst, or waits for one: the message is saved and the agent is not called.
 * previousAt: the message before hers, for the note that she came back another day. limit_due: the agent has a
 * conversation that reached the limit without it being applied; the message was not saved.
 */
type StartedTurn =
  | { ok: true; conversation: ConversationView; startedAt: Date; paused: boolean; previousAt: Date | null }
  | { ok: false; reason: "already_answered" | "message_conflict" }
  | { ok: false; reason: "limit_due"; conversationId: string };

/**
 * Saves the employee message in the active conversation, or in a new one, and counts it, in one batch: a single
 * round trip that SQLite runs as one transaction. Nothing holds the write lock across an await, so the agent
 * memory, which writes to the same database, never waits on it, and two tabs at once cannot open two
 * conversations or lose a count.
 *
 * The message is saved under the id the chat gave it. Sent again ("Tentar de novo", or the network dropped the
 * response) with the same text and still unanswered, it is answered, not saved twice, and the counter, which counts
 * the saved messages, does not move. Already answered, the chat is told so, to load the reply instead. Any other use
 * of a taken id is refused. Outside with_agent the message is saved and counted all the same, and the turn is paused: the
 * agent is not called (ARQUITETURA.md, section 6). A message also says she is on the chat, for the console.
 */
async function startTurn(deps: Pick<Deps, "db" | "directory">, { employeeId, id, text, now }: { employeeId: string; id: string; text: string; now: Date }) {
  const { db } = deps;
  const at = now.getTime();
  const [, , , [conversation]] = await db.batch([
    // The partial unique index (one conversation that is not closed per employee) makes this a no-op when it exists.
    // Written by hand: the conflict target of a partial index needs its WHERE before DO NOTHING.
    db.run(sql`
      insert into ${conversations} (id, employee_id, state, message_count, created_at)
      values (${`conv-${randomUUID()}`}, ${employeeId}, 'with_agent', 0, ${at})
      on conflict (employee_id) where state <> 'closed' do nothing`),
    db.run(sql`
      insert into ${messages} (id, conversation_id, author, text, parts, created_at)
      select ${id}, c.id, 'employee', ${text}, null, ${at}
      from ${conversations} c
      where c.employee_id = ${employeeId} and c.state <> 'closed'
        -- The agent answers no message past the limit: it applies first (applyLimit), then the message goes where it went.
        and not (c.state = 'with_agent' and c.message_count >= ${MESSAGE_LIMIT})
      on conflict (id) do nothing`),
    db
      .update(conversations)
      .set({
        messageCount: sql`(select count(*) from ${messages} m where m.conversation_id = ${conversations}.id and m.author = 'employee')`,
        employeeSeenAt: now,
      })
      .where(activeConversationOf(employeeId)),
    db
      .select({
        ...viewColumns,
        // The message under this id is this employee's, in this conversation, with this text.
        mine: sql<number>`exists (
          select 1 from ${messages} m
          where m.id = ${id} and m.conversation_id = ${conversations}.id and m.author = 'employee' and m.text = ${text}
        )`,
        // A reply came after it: it was already answered. A note of what she did in a card is not a reply.
        answered: sql<number>`exists (
          select 1 from ${messages} m join ${messages} r
            on r.conversation_id = m.conversation_id and r.created_at > m.created_at and r.author in ('agent', 'analyst')
          where m.id = ${id}
        )`,
        // The message before hers, whoever wrote it.
        previousAt: sql<number | null>`(
          select max(m.created_at) from ${messages} m where m.conversation_id = ${conversations}.id and m.id <> ${id}
        )`,
      })
      .from(conversations)
      .where(activeConversationOf(employeeId)),
  ]);
  if (!conversation) throw new Error("The active conversation is missing after it was ensured");
  const { mine, answered, previousAt, ...row } = conversation;
  if (!mine && row.state === "with_agent" && reachedLimit(row.messageCount)) return { ok: false, reason: "limit_due", conversationId: row.id } satisfies StartedTurn;
  // Anything but this employee's unanswered message would be answered without being saved or counted.
  if (!mine) return { ok: false, reason: "message_conflict" } satisfies StartedTurn;
  const paused = isPaused(row.state);
  if (!paused && answered) return { ok: false, reason: "already_answered" } satisfies StartedTurn;
  const view = await toConversationView(deps, row);
  return { ok: true, conversation: view, startedAt: now, paused, previousAt: previousAt === null ? null : new Date(previousAt) } satisfies StartedTurn;
}

/**
 * Saves the agent reply with the parts it streamed, its decision, and marks the first response of the conversation, in
 * one batch. The reply goes right after the message it answers, so whatever it did meanwhile (the note of a transfer)
 * comes after it, as nexo.pen draws them.
 */
async function saveReply(
  db: Db,
  { conversationId, startedAt, now, reply }: { conversationId: string; startedAt: Date; now: Date; reply: NexoUIMessage },
) {
  // The conversation part belongs to the moment the reply streamed; the conversation has the current one. A tool input
  // the agent refused is saved as the error it was, so the reply still matches the schemas when it is read back.
  const parts = withToolErrors(reply.parts.filter((part) => part.type !== "data-conversation"));
  const { record, toolsUsed } = summarizeTurn(parts);
  await db.batch([
    // The text column is the reply as a person reads it outside the chat: the console and the list show it.
    db.insert(messages).values({ id: reply.id, conversationId, author: "agent", text: replyText(parts), parts, createdAt: replyPlace(startedAt) }),
    db.insert(decisions).values({ id: `dec-${randomUUID()}`, messageId: reply.id, toolsUsed, ...record }),
    db
      .update(conversations)
      .set({ firstResponseAt: sql`coalesce(${conversations.firstResponseAt}, ${now.getTime()})` })
      .where(eq(conversations.id, conversationId)),
  ]);
}

/**
 * A reply that failed is not saved, so no card would ever show the drafts it made: they are discarded, never left
 * pending without a way to confirm or cancel them.
 */
async function discardDrafts(db: Db, reply: NexoUIMessage) {
  const ids = reply.parts.flatMap((part) => shownDraft(part)?.id ?? []);
  if (ids.length === 0) return;
  await db.update(drafts).set({ status: "cancelled" }).where(and(inArray(drafts.id, ids), eq(drafts.status, "pending")));
}

/**
 * A message while an analyst has the conversation: saved, and copied to the agent memory as she wrote it, so the agent
 * knows it if the conversation comes back. The answer is the conversation alone: nobody answers until the analyst does.
 */
async function pausedTurn(
  deps: Deps,
  { conversation, employeeId, id, text, at }: { conversation: ConversationView; employeeId: string; id: string; text: string; at: Date },
) {
  await rememberNote(deps.memory, { id, conversationId: conversation.id, employeeId, text, at, prefix: null });
  // The message that reaches the limit leaves its note here: the analyst stays with her. The chat reads it right after.
  if (reachedLimit(conversation.messageCount) && !conversation.limitReached) await applyLimit(deps, conversation.id);
  const stream = createUIMessageStream<NexoUIMessage>({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "data-conversation", data: conversation });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/**
 * She came back on another São Paulo day: before her message, the agent reads since when, so it looks again at what may
 * have changed. Under an id of her message, so a retry replaces the note instead of repeating it.
 */
async function rememberResume(
  deps: Deps,
  { conversationId, employeeId, messageId, previousAt, startedAt }: { conversationId: string; employeeId: string; messageId: string; previousAt: Date | null; startedAt: Date },
) {
  const text = resumeNote(previousAt, startedAt);
  if (!text) return;
  const at = new Date(startedAt.getTime() - 1);
  await rememberNote(deps.memory, { id: `resume-${messageId}`, conversationId, employeeId, text, at, prefix: RESUME_NOTE });
}

/**
 * POST /api/chat. Answers in parts: first the conversation with the new counter, then the agent stream in the
 * AI SDK v7 format. The reply is saved when it ends, even if the employee closes the tab: a copy of the stream is
 * read to the end on the server, and the platform waits for it.
 */
export async function chat(request: NextRequest, deps: Deps) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const body = await readBody(request, chatInput);
  if (!body.ok) return body.response;

  const employeeId = session.session.id;
  const { id, text } = body.data;
  let turn = await startTurn(deps, { employeeId, id, text, now: deps.now() });
  // The conversation reached the limit and it was not applied (the 30th was left without an answer): it applies now,
  // and the message goes where the conversation went, a new one or an analyst.
  if (!turn.ok && turn.reason === "limit_due") {
    await applyLimit(deps, turn.conversationId);
    turn = await startTurn(deps, { employeeId, id, text, now: deps.now() });
  }
  if (!turn.ok) {
    const { code, message } = REFUSALS[turn.reason];
    return jsonError(409, code, message);
  }

  const { conversation, startedAt } = turn;
  if (turn.paused) return pausedTurn(deps, { conversation, employeeId, id, text, at: startedAt });
  await rememberResume(deps, { conversationId: conversation.id, employeeId, messageId: id, previousAt: turn.previousAt, startedAt });
  const reply = streamReply(deps.agent, { conversationId: conversation.id, employeeId, text, startedAt });
  const stream = createUIMessageStream<NexoUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "data-conversation", data: conversation });
      const agentStream = toAISdkStream(await reply, { from: "agent", version: "v7", onError: () => AGENT_FAILED });
      // Mastra types its data parts loosely; this agent only streams text and the tools of NexoTools.
      writer.merge(agentStream as ReadableStream<InferUIMessageChunk<NexoUIMessage>>);
    },
    onError: () => AGENT_FAILED,
    onEnd: async ({ responseMessage, finishReason }) => {
      // A reply that failed, or never finished, is not saved: "Tentar de novo" asks for it again. One cut by the
      // step or token limits did finish, and is saved as it is.
      if (finishReason === undefined || finishReason === "error") {
        console.error("agent reply not saved", { conversationId: conversation.id, finishReason });
        await discardDrafts(deps.db, responseMessage);
        return;
      }
      await saveReply(deps.db, { conversationId: conversation.id, startedAt, now: deps.now(), reply: responseMessage });
      await closeIfResolved(deps, { conversationId: conversation.id, turnStartedAt: startedAt, reply: responseMessage });
      // The message that reached the limit is answered; the limit applies right after (ARQUITETURA.md, section 1).
      if (reachedLimit(conversation.messageCount)) await applyLimit(deps, conversation.id);
    },
  });
  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: ({ stream: copy }) => deps.waitUntil(consumeStream({ stream: copy })),
  });
}
