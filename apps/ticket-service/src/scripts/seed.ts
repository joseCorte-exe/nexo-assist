import { createDb } from "../db";
import { seed } from "../seed";

const db = createDb(process.env.TICKETS_DB_URL ?? "file:tickets.db", process.env.TICKETS_DB_AUTH_TOKEN);
await seed(db);
console.log("tickets DB seeded");
