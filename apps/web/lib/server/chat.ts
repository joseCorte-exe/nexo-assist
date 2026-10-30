import { randomUUID } from "node:crypto";
import { toAISdkStream } from "@mastra/ai-sdk";
import { streamReply } from "@nexo/agent";
import { chatInput, type ConversationPart, type NexoUIMessage, summarizeTurn, textOf, withToolErrors } from "@nexo/shared";
import { consumeStream, createUIMessageStream, createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type { Db } from "@/db";
import { conversations, decisions, drafts, messages } from "@/db/schema";
import { activeConversationOf } from "./conversation";
import type { Deps } from "./deps";
import { jsonError, readBody, readEmployeeSession } from "./http";

const AGENT_FAILED = "O Nexo não conseguiu responder. Tente de novo.";

const REFUSALS = {
  agent_paused: "Sua conversa está com um analista. Ele responde por aqui.",
  already_answered: "Essa mensagem já foi respondida.",
  message_conflict: "Essa mensagem já foi enviada.",
};

type StartedTurn =
  | { ok: true; conversation: ConversationPart; startedAt: Date }
  | { ok: false; reason: "agent_paused" | "already_answered" | "message_conflict" };

/**
 * Saves the employee message in the active conversation, or in a new one, and counts it, in one batch: a single
 * round trip that SQLite runs as one transaction. Nothing holds the write lock across an await, so the agent
 * memory, which writes to the same database, never waits on it, and two tabs at once cannot open two
 * conversations or lose a count.
 *
 * The message is saved under the id the chat gave it. Sent again ("Tentar de novo", or the network dropped the
 * response) with the same text and still unanswered, it is answered, not saved twice, and the counter, which counts
 * the saved messages, does not move. Already answered, the chat is told so, to load the reply instead. Any other use
 * of a taken id is refused. Outside with_agent nothing is saved and the agent is not called (feature 5).
 */
async function startTurn(db: Db, { employeeId, id, text, now }: { employeeId: string; id: string; text: string; now: Date }) {
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
      where c.employee_id = ${employeeId} and c.state = 'with_agent'
      on conflict (id) do nothing`),
    db
      .update(conversations)
      .set({
        messageCount: sql`(select count(*) from ${messages} m where m.conversation_id = ${conversations}.id and m.author = 'employee')`,
      })
      .where(sql`${activeConversationOf(employeeId)} and ${conversations.state} = 'with_agent'`),
    db
      .select({
        id: conversations.id,
        state: conversations.state,
        messageCount: conversations.messageCount,
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
      })
      .from(conversations)
      .where(activeConversationOf(employeeId)),
  ]);
  if (!conversation) throw new Error("The active conversation is missing after it was ensured");
  const { mine, answered, ...part } = conversation;
  if (part.state !== "with_agent") return { ok: false, reason: "agent_paused" } satisfies StartedTurn;
  // Anything but this employee's unanswered message would be answered without being saved or counted.
  if (!mine) return { ok: false, reason: "message_conflict" } satisfies StartedTurn;
  if (answered) return { ok: false, reason: "already_answered" } satisfies StartedTurn;
  return { ok: true, conversation: part, startedAt: now } satisfies StartedTurn;
}

/**
 * Saves the agent reply with the parts it streamed, its decision, and marks the first response of the
 * conversation, in one batch. The reply is never dated before the message it answers, even in the same millisecond.
 */
async function saveReply(
  db: Db,
  { conversationId, startedAt, now, reply }: { conversationId: string; startedAt: Date; now: Date; reply: NexoUIMessage },
) {
  // The counter belongs to the moment the reply streamed; the conversation has the current one. A tool input the
  // agent refused is saved as the error it was, so the reply still matches the schemas when it is read back.
  const parts = withToolErrors(reply.parts.filter((part) => part.type !== "data-conversation"));
  const { record, toolsUsed } = summarizeTurn(parts);
  const at = new Date(Math.max(now.getTime(), startedAt.getTime() + 1));
  await db.batch([
    db.insert(messages).values({ id: reply.id, conversationId, author: "agent", text: textOf(parts), parts, createdAt: at }),
    db.insert(decisions).values({ id: `dec-${randomUUID()}`, messageId: reply.id, toolsUsed, ...record }),
    db
      .update(conversations)
      .set({ firstResponseAt: sql`coalesce(${conversations.firstResponseAt}, ${at.getTime()})` })
      .where(eq(conversations.id, conversationId)),
  ]);
}

/**
 * A reply that failed is not saved, so no card would ever show the drafts it made: they are discarded, never left
 * pending without a way to confirm or cancel them.
 */
async function discardDrafts(db: Db, reply: NexoUIMessage) {
  const ids = reply.parts.flatMap((part) =>
    part.type === "tool-draftTicket" && part.state === "output-available" && part.output.ok ? [part.output.draft.id] : [],
  );
  if (ids.length === 0) return;
  await db.update(drafts).set({ status: "cancelled" }).where(and(inArray(drafts.id, ids), eq(drafts.status, "pending")));
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
  const turn = await startTurn(deps.db, { employeeId, id, text, now: deps.now() });
  if (!turn.ok) return jsonError(409, turn.reason, REFUSALS[turn.reason]);

  const { conversation, startedAt } = turn;
  const reply = streamReply(deps.agent, { conversationId: conversation.id, employeeId, text });
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
    },
  });
  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: ({ stream: copy }) => deps.waitUntil(consumeStream({ stream: copy })),
  });
}
