import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { e2eEnv, TICKETS_PORT, WEB_PORT } from "./e2e/env";

// The whole stack runs for real: the ticket-service and the web, each with its own fresh database.
// Only the LLM is out of the picture, and this feature does not use it.

const root = fileURLToPath(new URL("../..", import.meta.url));
// Each server deletes and recreates its own database when it starts. This file is loaded again by the
// test workers, so it must not touch the files itself.
const dataDir = fileURLToPath(new URL("./.e2e", import.meta.url));
const fresh = (file: string) => `mkdir -p ${dataDir} && rm -f ${dataDir}/${file}`;

export default defineConfig({
  testDir: "./e2e",
  // One worker: the outage test takes the ticket-service down for everyone.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: ".e2e/report" }]],
  outputDir: ".e2e/results",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      cwd: `${root}/apps/ticket-service`,
      command: `${fresh("tickets.db")} && pnpm exec tsx src/scripts/migrate.ts && pnpm exec tsx src/scripts/seed.ts && pnpm exec tsx src/server.ts`,
      env: { ...e2eEnv, TICKETS_DB_URL: `file:${dataDir}/tickets.db`, PORT: String(TICKETS_PORT) },
      port: TICKETS_PORT,
      reuseExistingServer: false,
    },
    {
      cwd: `${root}/apps/web`,
      command: `${fresh("conversations.db")} && pnpm exec tsx scripts/migrate.ts && pnpm exec tsx scripts/seed.ts && pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`,
      env: { ...e2eEnv, CONVERSATIONS_DB_URL: `file:${dataDir}/conversations.db` },
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
