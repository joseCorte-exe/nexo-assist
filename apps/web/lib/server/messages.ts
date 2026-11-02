import {
  type AnalystPart,
  analystPart,
  type ChatNote,
  chatNote,
  type ConsoleMessage,
  conversationView,
  type NexoUIMessage,
  nexoToolSchemas,
  replyText,
  shownDraft,
} from "@nexo/shared";
import { safeValidateUIMessages } from "ai";
import type { decisions, messages } from "@/db/schema";

// A saved message as the chat and the console read it. The parts are JSON as they were saved: checked against the
// schemas when read, so a change of format shows up here, logged, and never as a broken screen.

type MessageRow = typeof messages.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;

/** The data of the first part of a type, as it was saved, to be checked against its schema. */
function dataOf(row: MessageRow, type: "data-note" | "data-analyst"): unknown {
  const part = row.parts?.find((one) => one.type === type);
  return part && "data" in part ? part.data : undefined;
}

/** What a note of a transfer or of the console says, or null for the notes of what she did in a card. */
export function noteOf(row: MessageRow): ChatNote | null {
  if (row.author !== "system" || !row.event) return null;
  const note = chatNote.safeParse(dataOf(row, "data-note"));
  if (!note.success) console.error("saved note does not match its format", { messageId: row.id });
  return note.success ? note.data : null;
}

/** Who wrote an analyst message, by the name and level she read above it. */
export function signOf(row: MessageRow): AnalystPart | null {
  if (row.author !== "analyst") return null;
  const sign = analystPart.safeParse(dataOf(row, "data-analyst"));
  if (!sign.success) console.error("saved analyst message does not match its format", { messageId: row.id });
  return sign.success ? sign.data : null;
}

/** The message as the chat draws it: an agent reply with the parts it streamed, a note or an analyst message with theirs. */
export async function toUIMessage(row: MessageRow): Promise<NexoUIMessage> {
  const { id, author, text, parts } = row;
  const asText: NexoUIMessage = { id, role: author === "employee" ? "user" : "assistant", parts: [{ type: "text", text }] };
  if (author === "system") {
    const note = noteOf(row);
    return note ? { id, role: "system", parts: [{ type: "data-note", data: note }] } : { ...asText, role: "system" };
  }
  if (author === "analyst") {
    const sign = signOf(row);
    return sign ? { id, role: "assistant", parts: [{ type: "data-analyst", data: sign }, { type: "text", text }] } : asText;
  }
  return author === "agent" && parts ? savedReply({ ...asText, parts }, asText) : asText;
}

/** A reply that no longer matches the schemas of the tools is shown as its saved text. */
async function savedReply(message: NexoUIMessage, asText: NexoUIMessage): Promise<NexoUIMessage> {
  const checked = await safeValidateUIMessages<NexoUIMessage>({
    messages: [message],
    dataSchemas: { conversation: conversationView, note: chatNote, analyst: analystPart },
    tools: nexoToolSchemas,
  });
  if (checked.success) return checked.data[0]!;
  // Only the kind of error: its details can quote what the employee wrote.
  console.error("saved reply does not match the chat format", { messageId: message.id, error: checked.error.name });
  return asText;
}

/**
 * The message as the console shows it: who wrote it, the decision of an agent reply, the note, and whether she was on
 * the chat after it (the double check turns blue).
 */
export function toConsoleMessage(row: MessageRow, { decision, seenAt }: { decision: DecisionRow | null; seenAt: number }): ConsoleMessage {
  const sign = signOf(row);
  const note = noteOf(row);
  const reply = row.author === "agent";
  return {
    id: row.id,
    author: row.author,
    // Replies saved before their text column said the offer and the card are read from their parts.
    text: reply && row.parts ? replyText(row.parts) || row.text : row.text,
    at: row.createdAt.toISOString(),
    analyst: sign && row.authorId ? { id: row.authorId, ...sign } : null,
    decision: reply && decision ? { record: recordOf(decision), toolsUsed: decision.toolsUsed } : null,
    note: note && withoutTime(note),
    seen: (reply || row.author === "analyst") && seenAt >= row.createdAt.getTime(),
    draftId: reply ? (row.parts?.flatMap((part) => shownDraft(part)?.id ?? []).at(-1) ?? null) : null,
  };
}

const withoutTime = ({ at: _at, ...note }: ChatNote) => note;

/** The decision recorded in the first step, when the model gave a whole one. */
function recordOf({ understanding, action, confidence, reason }: DecisionRow) {
  return understanding && action && confidence !== null && reason ? { understanding, action, confidence, reason } : null;
}
