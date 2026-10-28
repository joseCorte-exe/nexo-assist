import { createDb } from "../db";
import { seed } from "../db/seed";

const db = createDb(process.env.CONVERSATIONS_DB_URL ?? "file:conversations.db", process.env.CONVERSATIONS_DB_AUTH_TOKEN);
await seed(db);
console.log("conversations DB seeded");
