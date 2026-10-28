import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { Db } from ".";

// Kept apart from db/index.ts: the app bundle must not try to pull in the migrations folder.
export function migrateDb(db: Db) {
  return migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
}
