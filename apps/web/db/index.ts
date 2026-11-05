import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

/**
 * How long a write waits for the lock of a local file, the same as the agent memory. Without it, a write fails at once
 * when another connection holds the lock, and a failure can cost the later writes on that connection. Turso has no such lock.
 */
const FILE_LOCK_TIMEOUT_MS = 5_000;

export function createDb(url: string, authToken?: string) {
  const client = createClient({ url, authToken: authToken || undefined, ...(url.startsWith("file:") ? { timeout: FILE_LOCK_TIMEOUT_MS } : {}) });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
