import { randomUUID } from "node:crypto";
import { toAISdkStream } from "@mastra/ai-sdk";
import { streamReply, type TurnResult } from "@nexo/agent";
import { chatInput, type ConversationPart } from "@nexo/shared";
import { createUIMessageStream, createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { desc, eq, sql } from "drizzle-orm";
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
 * Saves the employee message in the active conversation, or in a new one, and counts it, all in one write
 * transaction: two tabs sending at once cannot open two conversations or lose a count.
 * The same text sent again after a failed reply is answered without being saved twice.
 * Outside with_agent nothing is saved and the agent is not called (feature 5 handles those messages).
 */
async function startTurn(db: Db, { employeeId, text, now }: { employeeId: string; text: string; now: Date }) {
  return db.transaction(async (tx): Promise<StartedTurn> => {
    let [conversation] = await tx.select().from(conversations).where(activeConversationOf(employeeId)).limit(1);
    conversation ??= (
      await tx
        .insert(conversations)
        .values({ id: `conv-${randomUUID()}`, employeeId, state: "with_agent", messageCount: 0, createdAt: now })
        .returning()
    )[0];
    if (!conversation) throw new Error("Insert returned no conversation");
    if (conversation.state !== "with_agent") return { ok: false };

    // The same text right after a message the agent did not answer is that message sent again (the employee
    // pressed "Tentar de novo", or the network dropped the response): it is answered, not saved and counted twice.
    const [last] = await tx
      .select({ author: messages.author, text: messages.text })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (last?.author === "employee" && last.text === text) {
      const { id, state, messageCount } = conversation;
      return { ok: true, conversation: { id, state, messageCount }, startedAt: now };
    }

    await tx.insert(messages).values({
      id: `msg-${randomUUID()}`,
      conversationId: conversation.id,
      author: "employee",
      text,
      parts: null,
      createdAt: now,
    });
    const [counted] = await tx
      .update(conversations)
      .set({ messageCount: sql`${conversations.messageCount} + 1` })
      .where(eq(conversations.id, conversation.id))
      .returning({ messageCount: conversations.messageCount });
    return {
      ok: true,
      conversation: { id: conversation.id, state: conversation.state, messageCount: counted?.messageCount ?? 0 },
      startedAt: now,
    };
  });
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
