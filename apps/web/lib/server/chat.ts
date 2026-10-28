import { randomUUID } from "node:crypto";
import { toAISdkStream } from "@mastra/ai-sdk";
import { streamReply, type TurnResult } from "@nexo/agent";
import { chatInput, type ConversationPart } from "@nexo/shared";
import { createUIMessageStream, createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type { Db } from "@/db";
import { conversations, decisions, messages } from "@/db/schema";
import type { NexoUIMessage } from "@/lib/chat-message";
import { activeConversationOf } from "./conversation";
import type { Deps } from "./deps";
import { jsonError, readBody, readEmployeeSession } from "./http";

const AGENT_FAILED = "O Nexo não conseguiu responder. Tente de novo.";

type StartedTurn = { ok: true; conversation: ConversationPart; startedAt: Date } | { ok: false };

/**
 * Saves the employee message in the active conversation, or in a new one, and counts it, in one batch: a single
 * round trip that SQLite runs as one transaction. Nothing holds the write lock across an await, so the agent
 * memory, which writes to the same database, never waits on it, and two tabs at once cannot open two
 * conversations or lose a count.
 *
 * Outside with_agent nothing is saved and the agent is not called (feature 5 handles those messages).
 * The same text right after a message the agent did not answer is that message sent again (the employee pressed
 * "Tentar de novo", or the network dropped the response): it is answered, not saved and counted twice.
 */
async function startTurn(db: Db, { employeeId, text, now }: { employeeId: string; text: string; now: Date }) {
  const messageId = `msg-${randomUUID()}`;
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
      select ${messageId}, c.id, 'employee', ${text}, null, ${at}
      from ${conversations} c
      where c.employee_id = ${employeeId} and c.state = 'with_agent'
        and (
          select m.author || char(0) || m.text from ${messages} m
          where m.conversation_id = c.id order by m.created_at desc limit 1
        ) is not ('employee' || char(0) || ${text})`),
    db
      .update(conversations)
      .set({ messageCount: sql`${conversations.messageCount} + 1` })
      .where(sql`${conversations.id} = (select conversation_id from ${messages} where id = ${messageId})`),
    db
      .select({ id: conversations.id, state: conversations.state, messageCount: conversations.messageCount })
      .from(conversations)
      .where(activeConversationOf(employeeId)),
  ]);
  if (!conversation) throw new Error("The active conversation is missing after it was ensured");
  if (conversation.state !== "with_agent") return { ok: false } satisfies StartedTurn;
  return { ok: true, conversation, startedAt: now } satisfies StartedTurn;
}

/**
 * Saves the agent reply and its decision, and marks the first response of the conversation, in one batch.
 * The reply is never dated before the message it answers, even when both fall in the same millisecond.
 */
async function saveReply(
  db: Db,
  { conversationId, startedAt, now, result }: { conversationId: string; startedAt: Date; now: Date; result: TurnResult & { ok: true } },
) {
  const messageId = `msg-${randomUUID()}`;
  const at = new Date(Math.max(now.getTime(), startedAt.getTime() + 1));
  await db.batch([
    db.insert(messages).values({ id: messageId, conversationId, author: "agent", text: result.text, parts: null, createdAt: at }),
    db.insert(decisions).values({ id: `dec-${randomUUID()}`, messageId, ...result.decision }),
    db
      .update(conversations)
      .set({ firstResponseAt: sql`coalesce(${conversations.firstResponseAt}, ${at.getTime()})` })
      .where(eq(conversations.id, conversationId)),
  ]);
}

/**
 * POST /api/chat. Answers in parts: first the conversation with the new counter, then the agent stream in the
 * AI SDK v7 format. The reply is saved when it ends, even if the employee closes the tab: the agent output is
 * consumed on the server and the platform waits for the save.
 */
export async function chat(request: NextRequest, deps: Deps) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const body = await readBody(request, chatInput);
  if (!body.ok) return body.response;

  const employeeId = session.session.id;
  const turn = await startTurn(deps.db, { employeeId, text: body.data.text, now: deps.now() });
  if (!turn.ok) return jsonError(409, "agent_paused", "Sua conversa está com um analista. Ele responde por aqui.");

  const { conversation, startedAt } = turn;
  const reply = streamReply(deps.agent, { conversationId: conversation.id, employeeId, text: body.data.text });
  deps.waitUntil(
    reply.finished.then(async (result) => {
      if (result.ok) return saveReply(deps.db, { conversationId: conversation.id, startedAt, now: deps.now(), result });
      console.error("agent reply failed", { conversationId: conversation.id, error: result.error });
    }),
  );

  const stream = createUIMessageStream<NexoUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "data-conversation", data: conversation, transient: true });
      const agentStream = toAISdkStream(await reply.output, { from: "agent", version: "v7", onError: () => AGENT_FAILED });
      // Mastra types its data parts loosely; this agent only streams text and the tools of NexoTools.
      writer.merge(agentStream as ReadableStream<InferUIMessageChunk<NexoUIMessage>>);
    },
    onError: () => AGENT_FAILED,
  });
  return createUIMessageStreamResponse({ stream });
}
