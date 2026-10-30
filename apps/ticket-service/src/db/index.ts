import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function createDb(url: string, authToken?: string) {
  const client = createClient({ url, authToken: authToken || undefined });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
