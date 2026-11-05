import { decisionRecord } from "@nexo/shared";
import { type AgentModel, createMemory, createNexoAgent } from "../index";
import { fullReplyOf } from "../testing";
import { costOf, median, type TokenUsage } from "./report";
import { createWorld, NOW, type TicketChange, type World } from "./world";

/** The model is not deterministic: each case runs this many times, and only passes if every run does. */
export const RUNS = 3;
/** A provider error or a timeout under load says nothing about the agent: the run starts over, this many times at most. */
const MAX_ATTEMPTS = 3;

export type ToolRun = { name: string; args: unknown; result: unknown };

/** One reply of the agent: what it wrote, the tools that ran, in order, and what it took. */
export type Reply = { text: string; tools: ToolRun[]; usage: TokenUsage; ms: number };

/** One run of a case: the replies, one per message of the employee, and what the tools left in the world. */
export type CaseRun = { replies: Reply[]; world: World };

export type EvalCase = {
  name: string;
  /** The story of the PRD or the rule of Annex A the case is tied to. */
  rule: string;
  /** Who is talking; by default Ana, who has the sample tickets of Annex B. */
  employeeId?: string;
  /** Sample tickets read as resolved on another day. */
  resolved?: TicketChange[];
  /** What the employee writes, one message per reply. */
  messages: string[];
  /** Throws when the agent did not do what the rule says. Reads what the code can check, and of the text only what cases.ts says. */
  check: (run: CaseRun) => void;
};

export type RunResult = {
  passed: boolean;
  /** Why it did not pass; null when it did. */
  failure: string | null;
  replies: Reply[];
  ms: number;
  cost: number;
  /** Attempts lost to a provider error or a timeout. */
  retries: number;
};

export type CaseResult = { name: string; rule: string; passes: number; runs: RunResult[]; medianMs: number; medianCost: number; totalCost: number };

/** Plays the messages of a case against the agent: the real one, with the real tools, on a new world and a new memory. */
async function play(evalCase: EvalCase, model: AgentModel, onCost: (cost: number) => void): Promise<CaseRun> {
  const world = createWorld({ resolved: evalCase.resolved });
  const agent = createNexoAgent({
    model,
    memory: createMemory({ url: ":memory:" }),
    ticketService: world.desk,
    drafts: world.drafts,
    transfers: world.transfers,
    resolutions: world.resolutions,
    now: () => NOW,
  });
  const replies: Reply[] = [];
  for (const text of evalCase.messages) {
    const started = performance.now();
    const full = await fullReplyOf(agent, {
      conversationId: "conv-eval",
      employeeId: evalCase.employeeId ?? "emp-ana",
      text,
      startedAt: NOW,
    });
    const tools = full.steps.flatMap((step) =>
      step.toolCalls.map(({ payload }) => ({
        name: payload.toolName,
        args: payload.args,
        result: step.toolResults.find((result) => result.payload.toolCallId === payload.toolCallId)?.payload.result,
      })),
    );
    const usage = full.totalUsage;
    replies.push({ text: full.text, tools, usage, ms: performance.now() - started });
    onCost(costOf(usage));
  }
  return { replies, world };
}

/** What every reply owes, whatever the case: recordDecision first, with its four fields valid (ARQUITETURA.md, section 8). */
function checkDecisions({ replies }: CaseRun) {
  for (const [index, { tools }] of replies.entries()) {
    const first = tools[0];
    if (first?.name !== "recordDecision") throw new Error(`A resposta ${index + 1} não começou com recordDecision: ${first?.name ?? "nenhuma ferramenta"}`);
    const record = decisionRecord.safeParse(first.args);
    if (!record.success) throw new Error(`A resposta ${index + 1} gravou uma decisão inválida: ${record.error.message}`);
  }
}

/** One run of a case, started over when the provider fails. A model that never answers is a run that did not pass. */
export async function runOnce(evalCase: EvalCase, model: AgentModel, onCost: (cost: number) => void = () => {}): Promise<RunResult> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let run: CaseRun;
    try {
      run = await play(evalCase, model, onCost);
    } catch (error) {
      lastError = (error as Error).message;
      continue;
    }
    let failure: string | null = null;
    try {
      checkDecisions(run);
      evalCase.check(run);
    } catch (error) {
      failure = (error as Error).message;
    }
    return {
      passed: failure === null,
      failure,
      replies: run.replies,
      ms: run.replies.reduce((sum, reply) => sum + reply.ms, 0),
      cost: run.replies.reduce((sum, reply) => sum + costOf(reply.usage), 0),
      retries: attempt - 1,
    };
  }
  return { passed: false, failure: `O modelo não respondeu em ${MAX_ATTEMPTS} tentativas: ${lastError}`, replies: [], ms: 0, cost: 0, retries: MAX_ATTEMPTS };
}

/** The runs of a case, one after the other, summed up for the table. */
export function summarize({ name, rule }: Pick<EvalCase, "name" | "rule">, runs: RunResult[]): CaseResult {
  const answered = runs.filter((run) => run.replies.length > 0);
  return {
    name,
    rule,
    passes: runs.filter((run) => run.passed).length,
    runs,
    medianMs: median(answered.map((run) => run.ms)),
    medianCost: median(answered.map((run) => run.cost)),
    totalCost: runs.reduce((sum, run) => sum + run.cost, 0),
  };
}
