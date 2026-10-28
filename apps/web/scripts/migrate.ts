import { createDb } from "../db";
import { migrateDb } from "../db/migrate";

const db = createDb(process.env.CONVERSATIONS_DB_URL ?? "file:conversations.db", process.env.CONVERSATIONS_DB_AUTH_TOKEN);
await migrateDb(db);
console.log("conversations DB migrated");
