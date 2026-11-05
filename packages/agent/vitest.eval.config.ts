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
    // The worst case takes 13.5 min: 3 runs of up to 2 messages, 45 s each, every run tried up to 3 times.
    testTimeout: 15 * 60 * 1000,
    // The progress of each run appears as it happens.
    disableConsoleIntercept: true,
  },
});
