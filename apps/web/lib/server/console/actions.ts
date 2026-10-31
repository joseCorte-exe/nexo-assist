import { randomUUID } from "node:crypto";
import { CONSOLE_NOTE, saveNote } from "@nexo/agent";
import {
  type Analyst,
  type AnalystPart,
  analystMessageInput,
  type ChatNote,
  type ConsoleDetail,
  type ConsoleMessage,
  type ConversationEvent,
  LEVEL_LABEL,
  type NexoUIMessage,
} from "@nexo/shared";
import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { consoleReads, conversations, messages } from "@/db/schema";
import type { Deps } from "../deps";
import { jsonError, readAnalystSession, readBody, serviceUnavailable } from "../http";
import type { Session } from "../session";
import { notePart } from "../transfers";
import { conversationNotFound, loadDetail } from "./detail";

// What an analyst does to a conversation in the console (ARQUITETURA.md, sections 6 and 7). Each move is one conditional
// update with its note in the same batch: the note is only written if the update changed the row, so two clicks, two
// tabs or two analysts never leave two notes, and a move that lost the race is answered from the state that won. The
// note then goes to the agent memory, so the agent knows what happened when the conversation comes back to it.

type Row = typeof conversations.$inferSelect;
type Who = { session: Session; analyst: Analyst };

const notAssumed = () => jsonError(409, "not_assumed", "Assuma o atendimento antes.");
const closed = () => jsonError(409, "conversation_closed", "Esta conversa foi encerrada.");
const takenBy = (name: string) => jsonError(409, "assumed_by_other", `${name} já está atendendo esta conversa.`);

/** The analyst signed in, with their level, or the response to answer. */
async function analystOf(request: NextRequest, deps: Deps) {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session;
  const analysts = await deps.directory.analysts();
  const analyst = analysts?.get(session.session.id);
  if (!analysts || !analyst) return { ok: false as const, response: serviceUnavailable() };
  return { ok: true as const, who: { session: session.session, analyst }, analysts };
}

async function rowOf(deps: Deps, id: string): Promise<Row | null> {
  const [row] = await deps.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return row ?? null;
}

/** The name of whoever attends the conversation, for the refusal that says it. */
async function attendantName(deps: Deps, row: Row) {
  const analysts = await deps.directory.analysts();
  return analysts?.get(row.analystId ?? "")?.name ?? "Outro analista";
}

type Move = {
  event: Exclude<ConversationEvent, "transferred">;
  set: Partial<Row>;
  /** The states the conversation may move from. */
  from: SQL;
  /** What the note says in the conversation, and what the agent reads. */
  text: string;
  memory: string;
};

/**
 * Moves the conversation and notes it, in one batch; then copies the note to the memory. Answers whether this request
 * moved it and the id of the note, the key of what the ticket-service does about it.
 */
async function move(deps: Deps, row: Row, { analyst }: Who, { event, set, from, text, memory }: Move) {
  const at = deps.now();
  const noteId = `note-${row.id}-${event}-${randomUUID()}`;
  const note: ChatNote = {
    event,
    // The level says who the employee talks to now; releasing or closing hands it to nobody.
    level: event === "assumed" ? analyst.level : null,
    analystName: analyst.name,
    at: at.toISOString(),
  };
  const [moved] = await deps.db.batch([
    deps.db
      .update(conversations)
      .set(set)
      .where(and(eq(conversations.id, row.id), from))
      .returning({ id: conversations.id }),
    deps.db.run(sql`
      insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
      select ${noteId}, ${row.id}, 'system', ${analyst.id}, ${event}, ${text}, ${JSON.stringify(notePart(note))}, ${at.getTime()}
      where changes() = 1`),
  ]);
  if (moved.length === 0) return { moved: false as const };
  try {
    await saveNote(deps.memory, { id: noteId, conversationId: row.id, employeeId: row.employeeId, text: memory, at, prefix: CONSOLE_NOTE });
  } catch (error) {
    // The move and its note are saved: a memory that did not take the note only costs the agent context.
    console.error("note not copied to the agent memory", { conversationId: row.id, event, error: (error as Error).name });
  }
  return { moved: true as const, noteId };
}

async function answerDetail(deps: Deps, row: Row, who: Who, analysts: Map<string, Analyst>) {
  const loaded = await loadDetail(deps, row.id, who.analyst.id, analysts);
  return loaded.ok ? NextResponse.json<ConsoleDetail>(loaded.detail) : loaded.response;
}

/**
 * POST /api/console/conversations/:id/assume. Any analyst takes a conversation with the agent or waiting, whatever its
 * level (ARQUITETURA.md, section 2): the agent pauses, and the linked ticket is in service with them. One another
 * analyst attends is not taken.
 */
export async function assumeHandler(request: NextRequest, deps: Deps, id: string): Promise<Response> {
  const auth = await analystOf(request, deps);
  if (!auth.ok) return auth.response;
  const { who, analysts } = auth;
  const row = await rowOf(deps, id);
  if (!row) return conversationNotFound();
  if (row.state === "closed") return closed();
  if (row.state === "with_analyst") {
    return row.analystId === who.analyst.id ? answerDetail(deps, row, who, analysts) : takenBy(await attendantName(deps, row));
  }
  const { name, level } = who.analyst;
  const result = await move(deps, row, who, {
    event: "assumed",
    set: { state: "with_analyst", analystId: who.analyst.id, assumedAt: deps.now() },
    from: inArray(conversations.state, ["with_agent", "waiting_for_analyst"]),
    text: `${name} assumiu a conversa.`,
    memory: `${name}, analista do ${LEVEL_LABEL[level]}, assumiu a conversa. O agent está pausado até a conversa voltar para ele.`,
  });
  // Somebody moved it meanwhile: answer from the state that won.
  if (!result.moved) return assumeHandler(request, deps, id);
  if (row.ticketId) {
    const assigned = await deps.ticketService.assignTicket(row.ticketId, { employeeId: row.employeeId, analystId: who.analyst.id }, result.noteId);
    // The conversation is theirs either way; the ticket only misses the "Em atendimento".
    if (!assigned.ok) console.error("ticket not assigned", { ticketId: row.ticketId, error: assigned.error.code });
  }
  return answerDetail(deps, row, who, analysts);
}

/**
 * POST /api/console/conversations/:id/release. Hands a conversation back to the agent: one waiting for an analyst, or one
 * this analyst attends. Released already, it answers the same.
 */
export async function releaseHandler(request: NextRequest, deps: Deps, id: string): Promise<Response> {
  const auth = await analystOf(request, deps);
  if (!auth.ok) return auth.response;
  const { who, analysts } = auth;
  const row = await rowOf(deps, id);
  if (!row) return conversationNotFound();
  if (row.state === "closed") return closed();
  if (row.state === "with_agent") return answerDetail(deps, row, who, analysts);
  if (row.state === "with_analyst" && row.analystId !== who.analyst.id) return takenBy(await attendantName(deps, row));
  const { name } = who.analyst;
  const result = await move(deps, row, who, {
    event: "released",
    set: { state: "with_agent", analystId: null, assumedAt: null, waitUntil: null },
    from: or(
      eq(conversations.state, "waiting_for_analyst"),
      and(eq(conversations.state, "with_analyst"), eq(conversations.analystId, who.analyst.id)),
    )!,
    text: `${name} devolveu a conversa para o agent.`,
    memory: `${name} devolveu a conversa para o agent.`,
  });
  if (!result.moved) return releaseHandler(request, deps, id);
  return answerDetail(deps, row, who, analysts);
}

/**
 * POST /api/console/conversations/:id/close. Ends a conversation this analyst attends, as closed by the analyst. The
 * ticket does not change (ARQUITETURA.md, section 6). Closed by them already, it answers the same.
 */
export async function closeHandler(request: NextRequest, deps: Deps, id: string): Promise<Response> {
  const auth = await analystOf(request, deps);
  if (!auth.ok) return auth.response;
  const { who, analysts } = auth;
  const row = await rowOf(deps, id);
  if (!row) return conversationNotFound();
  if (row.state === "closed") {
    return row.outcome === "closed_by_analyst" && row.analystId === who.analyst.id ? answerDetail(deps, row, who, analysts) : closed();
  }
  if (row.state !== "with_analyst" || row.analystId !== who.analyst.id) return notAssumed();
  const { name } = who.analyst;
  const result = await move(deps, row, who, {
    event: "closed",
    set: { state: "closed", outcome: "closed_by_analyst", closedAt: deps.now() },
    from: and(eq(conversations.state, "with_analyst"), eq(conversations.analystId, who.analyst.id))!,
    text: `${name} encerrou o atendimento.`,
    memory: `${name} encerrou o atendimento.`,
  });
  if (!result.moved) return closeHandler(request, deps, id);
  return answerDetail(deps, row, who, analysts);
}

/**
 * POST /api/console/conversations/:id/messages. A message of the analyst in a conversation they attend, under the id the
 * console gave it: sent again, it is the same message. It shows in her chat with their name and level, and goes to the
 * agent memory.
 */
export async function messageHandler(request: NextRequest, deps: Deps, id: string): Promise<Response> {
  const auth = await analystOf(request, deps);
  if (!auth.ok) return auth.response;
  const { analyst } = auth.who;
  const body = await readBody(request, analystMessageInput);
  if (!body.ok) return body.response;
  const row = await rowOf(deps, id);
  if (!row) return conversationNotFound();

  const { id: messageId, text } = body.data;
  const at = deps.now();
  const sign: AnalystPart = { name: analyst.name, level: analyst.level };
  const parts: NexoUIMessage["parts"] = [{ type: "data-analyst", data: sign }, { type: "text", text }];
  const [, [saved]] = await deps.db.batch([
    deps.db.run(sql`
      insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
      select ${messageId}, c.id, 'analyst', ${analyst.id}, null, ${text}, ${JSON.stringify(parts)}, ${at.getTime()}
      from ${conversations} c
      where c.id = ${id} and c.state = 'with_analyst' and c.analyst_id = ${analyst.id}
      on conflict (id) do nothing`),
    deps.db.select().from(messages).where(eq(messages.id, messageId)),
  ]);
  if (!saved) return row.state === "closed" ? closed() : notAssumed();
  // The id is taken by something else: another conversation, another author, another text.
  if (saved.conversationId !== id || saved.authorId !== analyst.id || saved.text !== text) {
    return jsonError(409, "message_conflict", "Essa mensagem já foi enviada.");
  }
  try {
    const memory = `${analyst.name}, analista do ${LEVEL_LABEL[analyst.level]}, escreveu: "${text}"`;
    await saveNote(deps.memory, { id: messageId, conversationId: id, employeeId: row.employeeId, text: memory, at: saved.createdAt, prefix: CONSOLE_NOTE });
  } catch (error) {
    console.error("analyst message not copied to the agent memory", { conversationId: id, error: (error as Error).name });
  }
  const message: ConsoleMessage = {
    id: saved.id,
    author: "analyst",
    text: saved.text,
    at: saved.createdAt.toISOString(),
    analyst: { id: analyst.id, ...sign },
    decision: null,
    note: null,
    seen: (row.employeeSeenAt?.getTime() ?? 0) >= saved.createdAt.getTime(),
    draftId: null,
  };
  return NextResponse.json<ConsoleMessage>(message, { status: 201 });
}

/** POST /api/console/conversations/:id/read. What she wrote until now is read by this analyst. */
export async function readHandler(request: NextRequest, deps: Deps, id: string): Promise<Response> {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session.response;
  const at = deps.now();
  const [, [found]] = await deps.db.batch([
    deps.db.run(sql`
      insert into ${consoleReads} (analyst_id, conversation_id, read_at)
      select ${session.session.id}, c.id, ${at.getTime()} from ${conversations} c where c.id = ${id}
      on conflict (analyst_id, conversation_id) do update set read_at = max(read_at, excluded.read_at)`),
    deps.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id)),
  ]);
  return found ? new Response(null, { status: 204 }) : conversationNotFound();
}
