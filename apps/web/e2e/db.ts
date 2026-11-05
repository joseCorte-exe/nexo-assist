import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { localDay } from "@nexo/shared";

// The conversations database of the end-to-end run, written directly only to set a scene that takes days or dozens of
// messages to happen: a conversation left yesterday, or one a couple of messages from the limit. Everything after that
// goes through the app.

const db = createClient({ url: `file:${fileURLToPath(new URL("../.e2e/conversations.db", import.meta.url))}` });

const MINUTE = 60 * 1000;

const reply = (text: string, id: string) =>
  JSON.stringify([
    {
      type: "tool-recordDecision",
      toolCallId: `${id}-decision`,
      state: "output-available",
      input: { understanding: "Dúvida de TI", action: "Responder pela central de ajuda", confidence: 0.9, reason: "A central de ajuda cobre o caso." },
      output: { recorded: true },
    },
    { type: "text", text },
  ]);

/**
 * Gives the employee a conversation with the Nexo of `count` messages of hers, each answered, a minute apart, the last
 * one at `lastAt`. Whatever conversation she had open is closed first, as an analyst would have done.
 */
export async function conversationWith(employeeId: string, { count, lastAt, topic }: { count: number; lastAt: Date; topic: string }) {
  const id = `conv-e2e-${randomUUID()}`;
  const start = lastAt.getTime() - (count - 1) * 2 * MINUTE;
  const statements = [
    {
      sql: "update conversations set state = 'closed', outcome = 'closed_by_analyst', closed_at = ? where employee_id = ? and state <> 'closed'",
      args: [start - MINUTE, employeeId],
    },
    {
      // A conversation is only born with none active, so it is her newest, even in a scene set in the past.
      sql: `insert into conversations (id, employee_id, state, message_count, created_at, first_response_at)
            values (?, ?, 'with_agent', ?, max(?, (select coalesce(max(created_at) + 1, 0) from conversations where employee_id = ?)), ?)`,
      args: [id, employeeId, count, start, employeeId, start + 8_000],
    },
  ];
  for (let index = 0; index < count; index++) {
    const at = start + index * 2 * MINUTE;
    const text = index === 0 ? topic : `Mais um detalhe sobre isso (${index + 1}).`;
    const answer = index === 0 ? "Reinicie a impressora e tente de novo pelo portal de impressão." : "Anotado. Siga os passos da central de ajuda.";
    statements.push(
      { sql: "insert into messages (id, conversation_id, author, text, created_at) values (?, ?, 'employee', ?, ?)", args: [`${id}-u${index}`, id, text, at] },
      {
        sql: "insert into messages (id, conversation_id, author, text, parts, created_at) values (?, ?, 'agent', ?, ?, ?)",
        args: [`${id}-a${index}`, id, answer, reply(answer, `${id}-a${index}`), at + 8_000],
      },
    );
  }
  await db.batch(statements, "write");
  return id;
}

/** Uses up the day for everyone, or gives it back: the ceilings of this run are too high to reach by sending messages. */
export async function setDayUsedUp(usedUp: boolean) {
  const key = `global:${localDay(new Date())}`;
  await db.execute(
    usedUp
      ? { sql: "insert into usage_counters (key, count) values (?, 1000000) on conflict (key) do update set count = 1000000", args: [key] }
      : { sql: "delete from usage_counters where key = ?", args: [key] },
  );
}

/**
 * Removes the conversations this file wrote for these employees (the scenes set here, and what the app opened from
 * `since` on), with their messages, decisions, drafts and reads, so the files after it (the numbers of the login) find
 * the sample data as it was.
 */
export async function forgetSince(employeeIds: string[], since: Date) {
  const marks = employeeIds.map(() => "?").join(", ");
  const mine = `select id from conversations where employee_id in (${marks}) and (id like 'conv-e2e-%' or created_at >= ?)`;
  const args = [...employeeIds, since.getTime()];
  await db.batch(
    [
      { sql: `delete from decisions where message_id in (select id from messages where conversation_id in (${mine}))`, args },
      { sql: `delete from drafts where conversation_id in (${mine})`, args },
      { sql: `delete from console_reads where conversation_id in (${mine})`, args },
      { sql: `delete from messages where conversation_id in (${mine})`, args },
      { sql: `delete from conversations where id in (${mine})`, args },
    ],
    "write",
  );
}
