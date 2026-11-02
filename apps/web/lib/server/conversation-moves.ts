import { randomUUID } from "node:crypto";
import { type AgentMemory, CONSOLE_NOTE, rememberNote } from "@nexo/agent";
import {
  type Analyst,
  type AnalystLevel,
  type ChatNote,
  LEVEL_LABEL,
  MESSAGE_LIMIT,
  type NexoUIMessage,
  type NoteView,
  type TransferReason,
} from "@nexo/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { afterReplyPlace } from "./messages";

// How a conversation moves between the agent and the analysts (ARQUITETURA.md, sections 2 and 6): the agent transfers
// it; an analyst assumes, releases or closes it. Each move says, without a database, whether it applies to the row as it
// was read, what it sets and what its note says. applyMove then writes it over the version it read, and the note in the
// same batch, written only if the update changed the row: two clicks, two tabs or two analysts never leave two notes,
// and a move that lost the race is decided again on the row that won.

type Row = typeof conversations.$inferSelect;
type Who = Pick<Analyst, "id" | "name" | "level">;

/**
 * Why an analyst cannot do it: the conversation ended, they do not attend it, another analyst does, or the limit of
 * messages keeps it from going back to the agent.
 */
export type ConsoleRefusal = "closed" | "not_assumed" | "taken" | "limit_reached";
/** Why the agent cannot transfer: it no longer has the conversation. */
type AgentRefusal = "not_with_agent";
/**
 * Why the limit does not apply as planned: under 30 messages, ended, or it changed hands since it was planned (decide
 * again on the row as it is).
 */
export type LimitRefusal = "under_limit" | "closed" | "changed";
export type Decision<Refusal extends string> = "apply" | "already" | { refused: Refusal };

export type Move<Refusal extends string> = {
  /** On the row as it was read: move it, answer it as it is (it already is where this move takes it), or refuse. */
  decide: (row: Row) => Decision<Refusal>;
  set: (at: Date) => Partial<Row>;
  /** The note between the messages. The text is what the agent reads: in the text column, and in its memory if asked. */
  note: { authorId: string | null; note: NoteView; text: string; memory: boolean };
  /** Where the note goes among the messages; when it happened, unless said otherwise. */
  notePlace?: (at: Date) => Date;
};

export type TransferFields = {
  level: AnalystLevel;
  reason: TransferReason;
  summary: string;
  ticketId: string | null;
  waitUntil: Date;
  confidence: number | null;
  turnStartedAt: Date;
};

/** What the limit does with the conversation, as planned on the row it read (limit.ts). */
export type LimitPlan =
  /** With the agent and nothing pending. */
  | { kind: "close" }
  /** With the agent and something pending: to the level of the case, from her message the last reply answered. */
  | {
      kind: "transfer";
      /** The reason is the limit, unless its case is critical or overdue (routeTransfer). */
      fields: { level: AnalystLevel; reason: TransferReason; summary: string; ticketId: string | null; waitUntil: Date; since: Date };
    }
  /** An analyst has her (by name, unless the directory is down), or she waits for the level. */
  | { kind: "analyst"; analyst: { id: string; name: string | null } | null; level: AnalystLevel | null };

const refuse = <Refusal extends string>(refused: Refusal) => ({ refused });

/** Whether the row is still where the plan was made: the agent has it, or the same analyst or level. */
function stillAsPlanned(row: Row, plan: LimitPlan) {
  if (plan.kind !== "analyst") return row.state === "with_agent";
  if (plan.analyst) return row.state === "with_analyst" && row.analystId === plan.analyst.id;
  return row.state === "waiting_for_analyst" && row.targetLevel === plan.level;
}

/** The note of the limit: what the console and the chat draw, and what the agent reads. */
function limitNote(plan: LimitPlan): Move<LimitRefusal>["note"] {
  const lead = `A conversa chegou ao limite de ${MESSAGE_LIMIT} mensagens e`;
  if (plan.kind === "close") {
    return { authorId: null, note: { event: "limit_reached", then: "closed", level: null, analystName: null }, text: `${lead} foi encerrada.`, memory: true };
  }
  if (plan.kind === "transfer") {
    const { level } = plan.fields;
    return {
      authorId: null,
      note: { event: "limit_reached", then: "transferred", level, analystName: null },
      text: `${lead} foi transferida para o ${LEVEL_LABEL[level]}.`,
      memory: true,
    };
  }
  const { analyst, level } = plan;
  return {
    authorId: null,
    note: { event: "limit_reached", then: "analyst", level, analystName: analyst?.name ?? null },
    text: analyst ? `${lead} continua com ${analyst.name ?? "o analista"}.` : `${lead} espera o ${level ? LEVEL_LABEL[level] : "analista"}.`,
    memory: true,
  };
}

/** Whether this analyst attends the conversation, and may write in it or close it; if not, why. */
export function attends(row: Row, who: Who): "apply" | { refused: ConsoleRefusal } {
  if (row.state === "closed") return refuse("closed");
  if (row.state !== "with_analyst") return refuse("not_assumed");
  return row.analystId === who.id ? "apply" : refuse("taken");
}

export const moves: {
  transfer: (fields: TransferFields) => Move<AgentRefusal>;
  assume: (who: Who) => Move<ConsoleRefusal>;
  release: (who: Who) => Move<ConsoleRefusal>;
  close: (who: Who) => Move<ConsoleRefusal>;
  reachLimit: (plan: LimitPlan, lastMessageAt?: Date | null) => Move<LimitRefusal>;
} = {
  /** The agent hands the conversation to an analyst of the level, while it still has it. */
  transfer: ({ level, reason, summary, ticketId, waitUntil, confidence, turnStartedAt }: TransferFields): Move<AgentRefusal> => ({
    decide: (row) => (row.state === "with_agent" ? "apply" : refuse("not_with_agent")),
    set: (at) => ({
      state: "waiting_for_analyst",
      targetLevel: level,
      transferReason: reason,
      transferSummary: summary,
      transferConfidence: confidence,
      ticketId,
      waitUntil,
      transferredAt: at,
      needsAnalystSince: turnStartedAt,
      analystId: null,
      assumedAt: null,
    }),
    // The agent wrote the reply that announced it: its memory already has it. The note goes after that reply.
    note: { authorId: null, note: { event: "transferred", level }, text: `Transferida para o ${LEVEL_LABEL[level]}.`, memory: false },
    notePlace: (at) => afterReplyPlace(turnStartedAt, at),
  }),

  /** Any analyst takes a conversation with the agent or waiting, whatever its level: the agent pauses. */
  assume: (who: Who): Move<ConsoleRefusal> => ({
    decide: (row) => {
      if (row.state === "closed") return refuse("closed");
      if (row.state !== "with_analyst") return "apply";
      return row.analystId === who.id ? "already" : refuse("taken");
    },
    set: (at) => ({ state: "with_analyst", analystId: who.id, assumedAt: at }),
    note: {
      authorId: who.id,
      note: { event: "assumed", level: who.level, analystName: who.name },
      text: `${who.name}, analista do ${LEVEL_LABEL[who.level]}, assumiu a conversa. O agent está pausado até a conversa voltar para ele.`,
      memory: true,
    },
  }),

  /** Back to the agent: one waiting for an analyst, or one this analyst attends, unless the limit keeps it from the agent. */
  release: (who: Who): Move<ConsoleRefusal> => ({
    decide: (row) => {
      if (row.state === "closed") return refuse("closed");
      if (row.limitReachedAt) return refuse("limit_reached");
      if (row.state === "with_agent") return "already";
      return row.state === "with_analyst" && row.analystId !== who.id ? refuse("taken") : "apply";
    },
    set: () => ({ state: "with_agent", analystId: null, assumedAt: null, waitUntil: null }),
    note: {
      authorId: who.id,
      note: { event: "released", analystName: who.name },
      text: `${who.name} devolveu a conversa para o agent.`,
      memory: true,
    },
  }),

  /** Ends one this analyst attends, as closed by the analyst. The ticket does not change. */
  close: (who: Who): Move<ConsoleRefusal> => ({
    decide: (row) =>
      row.state === "closed" && row.outcome === "closed_by_analyst" && row.analystId === who.id ? "already" : attends(row, who),
    set: (at) => ({ state: "closed", outcome: "closed_by_analyst", closedAt: at }),
    note: {
      authorId: who.id,
      note: { event: "closed", analystName: who.name },
      text: `${who.name} encerrou o atendimento.`,
      memory: true,
    },
  }),

  /**
   * The limit of messages, once, at 30 of hers or more (ARQUITETURA.md, section 1): closes or transfers what the agent
   * has, or only marks what an analyst has. A row no longer where the plan was made is refused as changed, to be
   * planned again.
   */
  reachLimit: (plan: LimitPlan, lastMessageAt: Date | null = null): Move<LimitRefusal> => ({
    decide: (row) => {
      if (row.limitReachedAt) return "already";
      if (row.state === "closed") return refuse("closed");
      if (row.messageCount < MESSAGE_LIMIT) return refuse("under_limit");
      return stillAsPlanned(row, plan) ? "apply" : refuse("changed");
    },
    set: (at) => {
      if (plan.kind === "close") return { state: "closed", outcome: "limit_reached", closedAt: at, limitReachedAt: at };
      if (plan.kind === "analyst") return { limitReachedAt: at };
      const { level, reason, summary, ticketId, waitUntil, since } = plan.fields;
      return {
        ...moves.transfer({ level, reason, summary, ticketId, waitUntil, confidence: null, turnStartedAt: since }).set(at),
        limitReachedAt: at,
      };
    },
    note: limitNote(plan),
    // After the newest message, even the reply saved in the same millisecond.
    notePlace: (at) => (lastMessageAt && lastMessageAt.getTime() >= at.getTime() ? new Date(lastMessageAt.getTime() + 1) : at),
  }),
};

/** A move that keeps losing the race to other moves gives up after this many reads. */
const MAX_ATTEMPTS = 3;

export type MoveResult<Refusal extends string> =
  /** noteId: the note this move left, the key of what the ticket-service does about it; null if it already was so. */
  | { ok: true; row: Row; noteId: string | null }
  | { ok: false; refused: Refusal; row: Row }
  | { ok: false; refused: "not_found" | "busy"; row: null };

/** Reads the row, decides, and moves it if it did not change since; decided again on the row that won otherwise. */
export async function applyMove<Refusal extends string>(
  deps: { db: Db; memory: Pick<AgentMemory, "saveMessages"> },
  conversationId: string,
  move: Move<Refusal>,
  at: Date,
  /** The row as the caller just read it, to decide on without reading it again; read again only after a lost race. */
  read?: Row,
): Promise<MoveResult<Refusal>> {
  const { db } = deps;
  let known = read;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [row] = known ? [known] : await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    known = undefined;
    if (!row) return { ok: false, refused: "not_found", row: null };
    const decision = move.decide(row);
    if (decision === "already") return { ok: true, row, noteId: null };
    if (decision !== "apply") return { ok: false, refused: decision.refused, row };

    const { authorId, note, text, memory } = move.note;
    const noteId = `note-${conversationId}-${note.event}-${randomUUID()}`;
    const [[moved]] = await db.batch([
      db
        .update(conversations)
        .set({ ...move.set(at), version: row.version + 1 })
        .where(and(eq(conversations.id, conversationId), eq(conversations.version, row.version)))
        .returning(),
      noteIfMoved(db, {
        noteId,
        conversationId,
        authorId,
        text,
        note: { ...note, at: at.toISOString() },
        place: move.notePlace?.(at) ?? at,
      }),
    ]);
    if (!moved) continue;
    // The move and its note are saved; the memory tells the agent what happened when the conversation comes back to it.
    if (memory) await rememberNote(deps.memory, { id: noteId, conversationId, employeeId: moved.employeeId, text, at, prefix: CONSOLE_NOTE });
    return { ok: true, row: moved, noteId };
  }
  return { ok: false, refused: "busy", row: null };
}

/**
 * The parts a note is saved with: what happened, the level and who, as they were then. The chat and the console draw
 * the note from them, so a later name or level never rewrites the history.
 */
const noteParts = (note: ChatNote): NexoUIMessage["parts"] => [{ type: "data-note", data: note }];

/** The note of a move, in the batch right after its update, at its place: changes() reads the statement before it. */
function noteIfMoved(
  db: Db,
  {
    noteId,
    conversationId,
    authorId,
    text,
    note,
    place,
  }: { noteId: string; conversationId: string; authorId: string | null; text: string; note: ChatNote; place: Date },
) {
  return db.run(sql`
    insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
    select ${noteId}, ${conversationId}, 'system', ${authorId}, ${note.event}, ${text}, ${JSON.stringify(noteParts(note))}, ${place.getTime()}
    where changes() = 1`);
}
