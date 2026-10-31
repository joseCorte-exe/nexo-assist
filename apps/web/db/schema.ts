import type {
  Affected,
  AnalystLevel,
  Category,
  ConversationEvent,
  ConversationOutcome,
  ConversationState,
  DraftOperation,
  DraftRejection,
  DraftStatus,
  Impact,
  MessageAuthor,
  NexoUIMessage,
  Priority,
  TicketType,
  TransferReason,
  Urgency,
} from "@nexo/shared";
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull(),
    state: text("state").$type<ConversationState>().notNull(),
    outcome: text("outcome").$type<ConversationOutcome>(),
    targetLevel: text("target_level").$type<AnalystLevel>(),
    transferReason: text("transfer_reason").$type<TransferReason>(),
    transferSummary: text("transfer_summary"),
    /** The confidence the agent recorded in the reply that transferred: "Agent pediu ajuda · confiança 41%". */
    transferConfidence: real("transfer_confidence"),
    transferredAt: timestamp("transferred_at"),
    /** The analyst attending, or who closed it. */
    analystId: text("analyst_id"),
    assumedAt: timestamp("assumed_at"),
    ticketId: text("ticket_id"),
    /** Employee messages only: the x/30 counter. */
    messageCount: integer("message_count").notNull().default(0),
    waitUntil: timestamp("wait_until"),
    createdAt: timestamp("created_at").notNull(),
    firstResponseAt: timestamp("first_response_at"),
    closedAt: timestamp("closed_at"),
    /**
     * The newest message of the conversation, kept by a trigger on messages (migration 0004), so the console orders and
     * pages the list on an index instead of reading every message.
     */
    lastActivityAt: timestamp("last_activity_at"),
    /** The chat of the employee was open, and she was writing, until these moments: the console's "online" and "digitando…". */
    employeeSeenAt: timestamp("employee_seen_at"),
    employeeTypingUntil: timestamp("employee_typing_until"),
  },
  (table) => [
    // The list of the console, the most recent activity first.
    index("conversations_last_activity").on(table.lastActivityAt),
    // The queues: what waits at a level, and what an analyst attends.
    index("conversations_state_level").on(table.state, table.targetLevel),
    // Each employee has one active conversation at a time.
    uniqueIndex("conversations_one_active_per_employee")
      .on(table.employeeId)
      .where(sql`${table.state} <> 'closed'`),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    author: text("author").$type<MessageAuthor>().notNull(),
    /** The analyst who wrote an analyst message, or did what a note of the console tells. */
    authorId: text("author_id"),
    /** What a note of the console tells; null in a note of a draft and in every other message. */
    event: text("event").$type<ConversationEvent>(),
    text: text("text").notNull(),
    /**
     * The parts of an agent reply as it streamed (decision, tools, text), so the chat draws it the same way after a
     * reload. Later also the cards, options and drafts, plus the ids the agent must remember next turn.
     */
    parts: text("parts", { mode: "json" }).$type<NexoUIMessage["parts"]>(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [index("messages_conversation_created").on(table.conversationId, table.createdAt)],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id),
    toolsUsed: text("tools_used", { mode: "json" }).$type<string[]>().notNull(),
    // The four below are missing together in the reduced record, when the agent skipped recordDecision.
    understanding: text("understanding"),
    action: text("action"),
    confidence: real("confidence"),
    reason: text("reason"),
  },
  // One decision per agent message; loading a conversation joins on it.
  (table) => [uniqueIndex("decisions_message_id").on(table.messageId)],
);

/**
 * The draft of a ticket the agent showed for the employee to confirm (feature 4). A new ticket keeps what RN-01 read;
 * a follow-up or a reopening keeps the classification of its ticket, in ticket_id.
 */
export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    /** Shown as "Rascunho D-381": one sequence for every conversation. */
    number: integer("number").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    operation: text("operation").$type<DraftOperation>().notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    type: text("type").$type<TicketType>().notNull(),
    category: text("category").$type<Category>().notNull(),
    subcategory: text("subcategory"),
    // What RN-01 read. Null in a follow-up or a reopening, which keep the priority of their ticket.
    impact: text("impact").$type<Impact>(),
    urgency: text("urgency").$type<Urgency>(),
    priority: text("priority").$type<Priority>().notNull(),
    affected: text("affected").$type<Affected>().notNull(),
    /** The ticket followed up or reopened, or the one created once a new ticket is confirmed. */
    ticketId: text("ticket_id"),
    status: text("status").$type<DraftStatus>().notNull(),
    rejectedReason: text("rejected_reason").$type<DraftRejection>(),
    /** Why the agent judged it is not the same problem as an open ticket of the category. */
    notDuplicateReason: text("not_duplicate_reason"),
    /** When the answer is due: as if created when drafted, then the real one once confirmed. */
    dueAt: timestamp("due_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("drafts_number").on(table.number),
    // A conversation has at most one draft waiting: drafting again supersedes the one before.
    uniqueIndex("drafts_one_pending_per_conversation")
      .on(table.conversationId)
      .where(sql`${table.status} = 'pending'`),
    // The cards of a conversation load its drafts.
    index("drafts_conversation_created").on(table.conversationId, table.createdAt),
  ],
);

/** When each analyst last read each conversation: the unread count of the list is what she wrote after it. */
export const consoleReads = sqliteTable(
  "console_reads",
  {
    analystId: text("analyst_id").notNull(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    readAt: timestamp("read_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.analystId, table.conversationId] })],
);

/** Abuse limits: key is "ip:<ip>:<day>" or "global:<day>". Incremented atomically. */
export const usageCounters = sqliteTable("usage_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
});
