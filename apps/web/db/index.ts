import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

export function createDb(url: string, authToken?: string) {
  const client = createClient({ url, authToken: authToken || undefined });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

export function migrateDb(db: Db) {
  return migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
}
