import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./db/schema.ts",
  out: "./drizzle",
  // The Mastra memory tables live in the same database and are not ours to migrate.
  tablesFilter: ["!mastra_*"],
  dbCredentials: {
    url: process.env.CONVERSATIONS_DB_URL ?? "file:conversations.db",
    authToken: process.env.CONVERSATIONS_DB_AUTH_TOKEN,
  },
});
