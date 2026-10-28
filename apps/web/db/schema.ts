import type {
  Affected,
  AnalystLevel,
  Category,
  ConversationOutcome,
  ConversationState,
  DraftOperation,
  DraftStatus,
  Impact,
  MessageAuthor,
  Priority,
  TicketType,
  TransferReason,
  Urgency,
} from "@nexo/shared";
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    analystId: text("analyst_id"),
    ticketId: text("ticket_id"),
    /** Employee messages only: the x/30 counter. */
    messageCount: integer("message_count").notNull().default(0),
    waitUntil: timestamp("wait_until"),
    createdAt: timestamp("created_at").notNull(),
    firstResponseAt: timestamp("first_response_at"),
    closedAt: timestamp("closed_at"),
  },
  (table) => [
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
    text: text("text").notNull(),
    /** Cards, options and drafts shown with the message, plus the ids the agent must remember next turn. */
    parts: text("parts", { mode: "json" }),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [index("messages_conversation_created").on(table.conversationId, table.createdAt)],
);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => messages.id),
  understanding: text("understanding").notNull(),
  action: text("action").notNull(),
  toolsUsed: text("tools_used", { mode: "json" }).$type<string[]>().notNull(),
  /** Missing when the agent skipped recordDecision and the code saved a reduced record. */
  confidence: real("confidence"),
  reason: text("reason"),
});

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  operation: text("operation").$type<DraftOperation>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type").$type<TicketType>().notNull(),
  category: text("category").$type<Category>().notNull(),
  subcategory: text("subcategory"),
  impact: text("impact").$type<Impact>().notNull(),
  urgency: text("urgency").$type<Urgency>().notNull(),
  priority: text("priority").$type<Priority>().notNull(),
  affected: text("affected").$type<Affected>().notNull(),
  ticketId: text("ticket_id"),
  status: text("status").$type<DraftStatus>().notNull(),
  createdAt: timestamp("created_at").notNull(),
});

/** Abuse limits: key is "ip:<ip>:<day>" or "global:<day>". Incremented atomically. */
export const usageCounters = sqliteTable("usage_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
});
