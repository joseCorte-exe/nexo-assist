import { createDb } from "../db";
import { migrateDb } from "../db/migrate";

const db = createDb(process.env.TICKETS_DB_URL ?? "file:tickets.db", process.env.TICKETS_DB_AUTH_TOKEN);
await migrateDb(db);
console.log("tickets DB migrated");
