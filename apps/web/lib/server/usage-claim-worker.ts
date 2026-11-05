import { setTimeout as sleep } from "node:timers/promises";
import { createDb } from "@/db";
import { claimModelCall } from "./usage";

// A server instance for the concurrency tests of usage.test.ts: its own process and connection to the same database file,
// claiming `total` messages as fast as it can, or the same one over and over if `sameId` is given. Prints how many passed.

const [url, now, worker, total, perIp, global, sameId] = process.argv.slice(2);
const db = createDb(url!);
const deps = { db, usageLimits: { perIp: Number(perIp), global: Number(global) }, now: () => new Date(now!) };

// A file locked by another process makes a write wait for it, then refuses it whole, and it is sent again. Turso takes
// the writes in turn: this is only for a file shared by processes.
await db.$client.execute("pragma busy_timeout = 2000");

// Gives up before the test does, so a machine under load never leaves this process running after it.
const deadline = Date.now() + 90_000;

async function claim(messageId: string, ip: string): Promise<boolean> {
  try {
    return (await claimModelCall(deps, { messageId, ip })).outcome === "granted";
  } catch (error) {
    if ((error as { code?: string }).code !== "SQLITE_BUSY" || Date.now() > deadline) throw error;
    await sleep(5 + Math.random() * 50);
    return claim(messageId, ip);
  }
}

let passed = 0;
for (let index = 0; index < Number(total); index++) {
  if (await claim(sameId ?? `m${worker}-${index}`, `1.1.1.${index % 2}`)) passed++;
}
console.log(passed);
