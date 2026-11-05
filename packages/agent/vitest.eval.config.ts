import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `pnpm eval`: the agent against the real model, with the key of the .env at the root. `pnpm test` runs on the default
// config, which only picks up *.test.ts and never reaches these files.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env: the key may come from the environment. The suite says so when it is missing.
}

export default defineConfig({
  test: {
    include: ["src/evals/**/*.eval.ts"],
    // One run after the other: the medians are of a run alone, and the machine is shared.
    fileParallelism: false,
    // Three runs of a case with up to three turns, each of them limited to 45 s.
    testTimeout: 10 * 60 * 1000,
    // The progress of each run appears as it happens.
    disableConsoleIntercept: true,
  },
});
