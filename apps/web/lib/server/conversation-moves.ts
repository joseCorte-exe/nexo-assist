import { randomUUID } from "node:crypto";
import { type AgentMemory, CONSOLE_NOTE, saveNote } from "@nexo/agent";
import { type Analyst, type AnalystLevel, type ChatNote, LEVEL_LABEL, type NexoUIMessage, type NoteView, type TransferReason } from "@nexo/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { conversations, messages } from "@/db/schema";

// How a conversation moves between the agent and the analysts (ARQUITETURA.md, sections 2 and 6): the agent transfers
// it; an analyst assumes, releases or closes it. Each move says, without a database, whether it applies to the row as it
// was read, what it sets and what its note says. applyMove then writes it with an update that only checks the row did
// not change since it was read, and the note in the same batch, written only if the update changed the row: two clicks,
// two tabs or two analysts never leave two notes, and a move that lost the race is decided again on the row that won.

type Row = typeof conversations.$inferSelect;
type Who = Pick<Analyst, "id" | "name" | "level">;

export type Refusal = "closed" | "not_assumed" | "taken" | "not_with_agent";
type Decision = "apply" | "already" | { refused: Refusal };

export type Move = {
  /** On the row as it was read: move it, answer it as it is (it already is where this move takes it), or refuse. */
  decide: (row: Row) => Decision;
  set: (at: Date) => Partial<Row>;
  /** The note between the messages. The text is what the agent reads: in the text column, and in its memory if asked. */
  note: { authorId: string | null; note: NoteView; text: string; memory: boolean };
};

export type TransferFields = {
  level: AnalystLevel;
  reason: TransferReason;
  summary: string;
  ticketId: string | null;
  waitUntil: Date;
  confidence: number | null;
};

const refuse = (refused: Refusal): Decision => ({ refused });

/** Taken by an analyst: by this one it already is, by another it is theirs. */
const attended = (row: Row, who: Who): Decision => (row.analystId === who.id ? "already" : refuse("taken"));

export const moves = {
  /** The agent hands the conversation to an analyst of the level, while it still has it. */
  transfer: ({ level, reason, summary, ticketId, waitUntil, confidence }: TransferFields): Move => ({
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
      analystId: null,
      assumedAt: null,
    }),
    // The agent wrote the reply that announced it: its memory already has it.
    note: { authorId: null, note: { event: "transferred", level }, text: `Transferida para o ${LEVEL_LABEL[level]}.`, memory: false },
  }),

  /** Any analyst takes a conversation with the agent or waiting, whatever its level: the agent pauses. */
  assume: (who: Who): Move => ({
    decide: (row) => {
      if (row.state === "closed") return refuse("closed");
      return row.state === "with_analyst" ? attended(row, who) : "apply";
    },
    set: (at) => ({ state: "with_analyst", analystId: who.id, assumedAt: at }),
    note: {
      authorId: who.id,
      note: { event: "assumed", level: who.level, analystName: who.name },
      text: `${who.name}, analista do ${LEVEL_LABEL[who.level]}, assumiu a conversa. O agent está pausado até a conversa voltar para ele.`,
      memory: true,
    },
  }),

  /** Back to the agent: one waiting for an analyst, or one this analyst attends. */
  release: (who: Who): Move => ({
    decide: (row) => {
      if (row.state === "closed") return refuse("closed");
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
  close: (who: Who): Move => ({
    decide: (row) => {
      if (row.state === "closed") return row.outcome === "closed_by_analyst" && row.analystId === who.id ? "already" : refuse("closed");
      return row.state === "with_analyst" && row.analystId === who.id ? "apply" : refuse("not_assumed");
    },
    set: (at) => ({ state: "closed", outcome: "closed_by_analyst", closedAt: at }),
    note: {
      authorId: who.id,
      note: { event: "closed", analystName: who.name },
      text: `${who.name} encerrou o atendimento.`,
      memory: true,
    },
  }),
};

/** A move that keeps losing the race to other moves gives up after this many reads. */
const MAX_ATTEMPTS = 3;

export type MoveResult =
  /** noteId: the note this move left, the key of what the ticket-service does about it; null if it already was so. */
  | { ok: true; row: Row; noteId: string | null }
  | { ok: false; refused: Refusal; row: Row }
  | { ok: false; refused: "not_found" | "busy"; row: null };

/** Reads the row, decides, and moves it if it did not change since; decided again on the row that won otherwise. */
export async function applyMove(
  deps: { db: Db; memory: Pick<AgentMemory, "saveMessages"> },
  conversationId: string,
  move: Move,
  at: Date,
): Promise<MoveResult> {
  const { db } = deps;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!row) return { ok: false, refused: "not_found", row: null };
    const decision = move.decide(row);
    if (decision === "already") return { ok: true, row, noteId: null };
    if (decision !== "apply") return { ok: false, refused: decision.refused, row };

    const { authorId, note, text, memory } = move.note;
    const noteId = `note-${conversationId}-${note.event}-${randomUUID()}`;
    const [[moved]] = await db.batch([
      db
        .update(conversations)
        .set(move.set(at))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.state, row.state),
            row.analystId === null ? isNull(conversations.analystId) : eq(conversations.analystId, row.analystId),
          ),
        )
        .returning(),
      noteIfMoved(db, { noteId, conversationId, authorId, text, note: { ...note, at: at.toISOString() } }),
    ]);
    if (!moved) continue;
    if (memory) await remember(deps.memory, { noteId, row: moved, text, at });
    return { ok: true, row: moved, noteId };
  }
  return { ok: false, refused: "busy", row: null };
}

/** The note goes to the agent memory, so the agent knows what happened when the conversation comes back to it. */
async function remember(memory: Pick<AgentMemory, "saveMessages">, { noteId, row, text, at }: { noteId: string; row: Row; text: string; at: Date }) {
  try {
    await saveNote(memory, { id: noteId, conversationId: row.id, employeeId: row.employeeId, text, at, prefix: CONSOLE_NOTE });
  } catch (error) {
    // The move and its note are saved: a memory that did not take the note only costs the agent context.
    console.error("note not copied to the agent memory", { conversationId: row.id, error: (error as Error).name });
  }
}

/**
 * The parts a note is saved with: what happened, the level and who, as they were then. The chat and the console draw
 * the note from them, so a later name or level never rewrites the history.
 */
const noteParts = (note: ChatNote): NexoUIMessage["parts"] => [{ type: "data-note", data: note }];

/**
 * The note of a move, in the batch right after its update: changes() reads the statement before it. It goes after every
 * message already there and after the place of the reply the agent may be writing (the message it answers + 1 ms), so a
 * note never shows before what led to it, even within the same millisecond.
 */
function noteIfMoved(
  db: Db,
  { noteId, conversationId, authorId, text, note }: { noteId: string; conversationId: string; authorId: string | null; text: string; note: ChatNote },
) {
  return db.run(sql`
    insert into ${messages} (id, conversation_id, author, author_id, event, text, parts, created_at)
    select ${noteId}, ${conversationId}, 'system', ${authorId}, ${note.event}, ${text}, ${JSON.stringify(noteParts(note))},
      max(${new Date(note.at).getTime()}, coalesce((select max(m.created_at) from ${messages} m where m.conversation_id = ${conversationId}), 0) + 2)
    where changes() = 1`);
}
