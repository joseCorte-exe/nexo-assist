import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_MODEL } from "../index";
import { cases } from "./cases";
import { dollars, renderReport, seconds, toolNames } from "./report";
import { type CaseResult, RUNS, type RunResult, runOnce, summarize } from "./run";

// `pnpm eval`: every case against the real model, RUNS times each. Run it with -t to try one case; docs/evals/resultado.md
// is only rewritten by a run of all of them.

/** A run of the whole suite costs a few tens of cents. Past this, something is wrong: stop spending and say so. */
const BUDGET_USD = 1;
const REPORT = new URL("../../../../docs/evals/resultado.md", import.meta.url);

const results: CaseResult[] = [];
let spent = 0;

describe("the agent against the real model", () => {
  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("pnpm eval calls the real model and needs ANTHROPIC_API_KEY in the .env at the root.");
  });

  afterAll(() => {
    if (results.length !== cases.length) return;
    const report = renderReport(results, { model: AGENT_MODEL, at: new Date() });
    writeFileSync(REPORT, report);
    console.log(`\n${report}`);
  });

  it.each(cases)("$name", async (evalCase) => {
    const runs: RunResult[] = [];
    for (let index = 0; index < RUNS; index++) {
      if (spent > BUDGET_USD) {
        runs.push({ passed: false, failure: `Parou: gastou ${dollars(spent)}, acima do limite de ${dollars(BUDGET_USD)}.`, replies: [], ms: 0, cost: 0, retries: 0 });
        continue;
      }
      const run = await runOnce(evalCase, AGENT_MODEL, (cost) => {
        spent += cost;
      });
      runs.push(run);
      const verdict = run.passed ? "ok" : `FALHOU: ${run.failure}`;
      console.log(`[${evalCase.name}] ${index + 1}/${RUNS} ${seconds(run.ms)} ${dollars(run.cost)} [${toolNames(run.replies).join(" | ")}] ${verdict} (total ${dollars(spent)})`);
    }
    const result = summarize(evalCase, runs);
    results.push(result);
    const failures = runs.flatMap((run) => run.failure ?? []);
    expect(result.passes, failures.join("\n")).toBe(RUNS);
  });
});
