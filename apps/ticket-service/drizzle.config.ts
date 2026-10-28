import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TICKETS_DB_URL ?? "file:tickets.db",
    authToken: process.env.TICKETS_DB_AUTH_TOKEN,
  },
});
