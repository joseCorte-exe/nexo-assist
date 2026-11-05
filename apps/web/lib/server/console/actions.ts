import { CONSOLE_NOTE, rememberNote } from "@nexo/agent";
import { type Analyst, type AnalystPart, analystMessageInput, type ConsoleDetail, type ConsoleMessage, LEVEL_LABEL, type NexoUIMessage } from "@nexo/shared";
import { eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { consoleReads, conversations, messages } from "@/db/schema";
import { applyMove, attends, type ConsoleRefusal, type Move, moves } from "../conversation-moves";
import type { Deps } from "../deps";
import { jsonError, readAnalystSession, readBody, serviceUnavailable } from "../http";
import { toConsoleMessage } from "../messages";
import { conversationNotFound, loadDetail } from "./detail";

// What an analyst does to a conversation in the console (ARQUITETURA.md, sections 6 and 7): assume, release and close
// are moves of the conversation (conversation-moves.ts), each answered with the conversation as it is after it; a
// message is written only while the analyst attends it.

const notAssumed = () => jsonError(409, "not_assumed", "Assuma o atendimento antes.");
const closed = () => jsonError(409, "conversation_closed", "Esta conversa foi encerrada.");
const busy = () => jsonError(409, "conversation_busy", "A conversa acabou de mudar. Tente de novo.");

/** The analyst signed in, with their level, or the response to answer. */
async function analystOf(request: NextRequest, deps: Deps) {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session;
  const analysts = await deps.directory.analysts();
  const analyst = analysts?.get(session.session.id);
  if (!analysts || !analyst) return { ok: false as const, response: serviceUnavailable() };
  return { ok: true as const, analyst, analysts };
}

type Row = typeof conversations.$inferSelect;

/** Why the analyst could not do it, in the words of the console. */
function refusal(refused: ConsoleRefusal | "not_found" | "busy", row: Row | null, analysts: Map<string, Analyst>) {
  switch (refused) {
    case "not_found":
      return conversationNotFound();
    case "closed":
      return closed();
    case "not_assumed":
      return notAssumed();
    case "taken": {
      const name = analysts.get(row?.analystId ?? "")?.name ?? "Outro analista";
      return jsonError(409, "assumed_by_other", `${name} já está atendendo esta conversa.`);
    }
    case "busy":
      return busy();
    case "limit_reached":
      return jsonError(409, "limit_reached", "Esta conversa chegou ao limite de mensagens e não volta para o agent. Encerre quando terminar.");
  }
}

type Moved = { row: Row; noteId: string; analyst: Analyst };

/**
 * A move of the console as a route: the analyst signed in moves the conversation and gets it back as it is now, whether
 * it moved or already was so. What the move leaves outside the conversations database runs after it, once.
 */
function consoleMove(build: (analyst: Analyst) => Move<ConsoleRefusal>, after?: (deps: Deps, moved: Moved) => Promise<void>) {
  return async (request: NextRequest, deps: Deps, id: string): Promise<Response> => {
    const auth = await analystOf(request, deps);
    if (!auth.ok) return auth.response;
    const { analyst, analysts } = auth;
    const result = await applyMove(deps, id, build(analyst), deps.now());
    if (!result.ok) return refusal(result.refused, result.row, analysts);
    if (result.noteId && after) await after(deps, { row: result.row, noteId: result.noteId, analyst });
    const loaded = await loadDetail(deps, id, analyst.id, analysts);
    return loaded.ok ? NextResponse.json<ConsoleDetail>(loaded.detail) : loaded.response;
  };
}

/**
 * The ticket the agent linked is in service with whoever assumed: the row is the one the move left, so a ticket the agent
 * linked while the analyst was assuming counts. The note is the key, so a retry assigns it once.
 */
async function assignTicket(deps: Deps, { row, noteId, analyst }: Moved) {
  if (!row.ticketId) return;
  const assigned = await deps.ticketService.assignTicket(row.ticketId, { employeeId: row.employeeId, analystId: analyst.id }, noteId);
  // The conversation is theirs either way; the ticket only misses the "Em atendimento".
  if (!assigned.ok) console.error("ticket not assigned", { ticketId: row.ticketId, error: assigned.error.code });
}

/** POST /api/console/conversations/:id/assume. The agent pauses, and the linked ticket is in service with them. */
export const assumeHandler = consoleMove(moves.assume, assignTicket);

/** POST /api/console/conversations/:id/release. Back to the agent, which answers her again. */
export const releaseHandler = consoleMove(moves.release);

/** POST /api/console/conversations/:id/close. Closed by the analyst; the ticket does not change (ARQUITETURA.md, section 6). */
export const closeHandler = consoleMove(moves.close);

/**
 * The message of the analyst is the answer of IT on the ticket of the conversation, which restarts its deadline (RN-02).
 * The message is the key, so a retry notes it once. The message is saved already and reaches her chat either way, so a
 * failure is logged, without the text: until a next message gets through, the ticket keeps the deadline it had.
 */
async function answerTicket(deps: Deps, row: Row, messageId: string, text: string) {
  if (!row.ticketId) return;
  const answered = await deps.ticketService.answerTicket(row.ticketId, { employeeId: row.employeeId, text }, messageId);
  // A resolved ticket has no deadline to restart: nothing went wrong.
  if (answered.ok || answered.error.serviceCode === "ticket_resolved") return;
  console.error("analyst answer not noted on the ticket", { ticketId: row.ticketId, messageId, error: answered.error.code });
}

/**
 * POST /api/console/conversations/:id/messages. A message of the analyst in a conversation they attend, under the id the
 * console gave it: sent again, it is the same message. Written over the version of the conversation it was decided on,
 * so a move in between is never written past. It shows in her chat with their name and level, goes to the agent memory
 * and, after the response, to the linked ticket: the analyst does not wait for the ticket-service to see it sent.
 */
export async function messageHandler(request: NextRequest, deps: Deps, id: string): Promise<Response> {
  const auth = await analystOf(request, deps);
  if (!auth.ok) return auth.response;
  const { analyst } = auth;
  const body = await readBody(request, analystMessageInput);
  if (!body.ok) return body.response;
  const { id: messageId, text } = body.data;
  const [[row], [sent]] = await deps.db.batch([
    deps.db.select().from(conversations).where(eq(conversations.id, id)).limit(1),
    deps.db.select().from(messages).where(eq(messages.id, messageId)),
  ]);
  if (!row) return conversationNotFound();
  // Sent before, and only the response was lost: it is answered as sent, whatever happened to the conversation since.
  if (sent) return sentMessage(sent, { id, analyst, text, row });
  const decision = attends(row, analyst);
  if (decision !== "apply") return refusal(decision.refused, row, auth.analysts);

  const at = deps.now();
  const sign: AnalystPart = { name: analyst.name, level: analyst.level };
  const parts: NexoUIMessage["parts"] = [{ type: "data-analyst", data: sign }, { type: "text", text }];
  const [inserted, [saved]] = await deps.db.batch([
    deps.db.run(sql`
      insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
      select ${messageId}, c.id, 'analyst', ${analyst.id}, null, ${text}, ${JSON.stringify(parts)}, ${at.getTime()}
      from ${conversations} c
      where c.id = ${id} and c.version = ${row.version}
      on conflict (id) do nothing`),
    deps.db.select().from(messages).where(eq(messages.id, messageId)),
  ]);
  // The conversation moved since it was read: the analyst sends again on the state it is in now.
  if (!saved) return busy();
  if (inserted.rowsAffected === 1) {
    const memory = `${analyst.name}, analista do ${LEVEL_LABEL[analyst.level]}, escreveu: "${text}"`;
    await rememberNote(deps.memory, { id: messageId, conversationId: id, employeeId: row.employeeId, text: memory, at, prefix: CONSOLE_NOTE });
    deps.waitUntil(answerTicket(deps, row, messageId, text));
  }
  return sentMessage(saved, { id, analyst, text, row });
}

/** The message saved under the id: this one, as the console shows it, or a refusal if the id is taken by another. */
function sentMessage(saved: typeof messages.$inferSelect, { id, analyst, text, row }: { id: string; analyst: Analyst; text: string; row: Row }) {
  if (saved.conversationId !== id || saved.authorId !== analyst.id || saved.text !== text) {
    return jsonError(409, "message_conflict", "Essa mensagem já foi enviada.");
  }
  const message = toConsoleMessage(saved, { decision: null, seenAt: row.employeeSeenAt?.getTime() ?? 0 });
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
