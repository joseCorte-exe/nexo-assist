import type { AnalystLevel, Affected, Category, Priority, TicketStatus, TicketType, UpdateAuthor } from "@nexo/shared";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  department: text("department").notNull(),
  passwordChangedAt: timestamp("password_changed_at"),
});

export const analysts = sqliteTable("analysts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  level: text("level").$type<AnalystLevel>().notNull(),
  available: integer("available", { mode: "boolean" }).notNull(),
});

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  type: text("type").$type<TicketType>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").$type<Category>().notNull(),
  subcategory: text("subcategory"),
  priority: text("priority").$type<Priority>().notNull(),
  affected: text("affected").$type<Affected>().notNull(),
  status: text("status").$type<TicketStatus>().notNull(),
  openedBy: text("opened_by")
    .notNull()
    .references(() => employees.id),
  assignedTo: text("assigned_to").references(() => analysts.id),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  lastItResponseAt: timestamp("last_it_response_at"),
  dueAt: timestamp("due_at").notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  // The tickets of an employee, most recent first: the list and the lookup of the chat both start here.
  index("tickets_opened_by_created_at_idx").on(table.openedBy, table.createdAt),
]);

export const ticketUpdates = sqliteTable("ticket_updates", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .references(() => tickets.id),
  author: text("author").$type<UpdateAuthor>().notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [index("ticket_updates_ticket_id_created_at_idx").on(table.ticketId, table.createdAt)]);

export const kbArticles = sqliteTable("kb_articles", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").$type<Category>().notNull(),
  keywords: text("keywords", { mode: "json" }).$type<string[]>().notNull(),
});

/** Saved in the same transaction as the write, so a retry returns what was already written. */
export const idempotencyKeys = sqliteTable("idempotency_keys", {
  key: text("key").primaryKey(),
  /**
   * The request the key was used for and whose it was ("PATCH /tickets/INC-20311 for emp-ana"): reused for another one,
   * it is refused. The default only marks the keys saved before the column, which no new request replays.
   */
  scope: text("scope").notNull().default("POST /tickets"),
  response: text("response", { mode: "json" }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

/** Single row (id = 1) holding the current simulated outage window. */
export const serviceState = sqliteTable("service_state", {
  id: integer("id").primaryKey(),
  unavailableUntil: timestamp("unavailable_until"),
});
