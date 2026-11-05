import { describe, expect, it } from "vitest";
import { scriptedModel } from "../testing";
import { cases } from "./cases";
import { costOf, median, renderReport } from "./report";
import { runOnce, summarize } from "./run";
import { createWorld, NOW } from "./world";

// What `pnpm eval` stands on, without calling the model: the cost, the table, the fixed world, and checks that can fail.

const caseNamed = (name: string) => {
  const found = cases.find((one) => one.name === name);
  if (!found) throw new Error(`No case named ${name}`);
  return found;
};

const decision = { understanding: "Entendi o pedido", action: "Seguir a regra", confidence: 0.9, reason: "É o que a regra diz." };
const decide = { toolCalls: [{ toolName: "recordDecision", input: decision }] };

describe("costOf", () => {
  it("charges what came from the cache at the cache price, and the rest as input", () => {
    // 1 million in, 400 thousand of them from the cache, and 100 thousand out.
    expect(costOf({ inputTokens: 1_000_000, cachedInputTokens: 400_000, outputTokens: 100_000 })).toBeCloseTo(0.06 + 0.004 + 0.05);
  });
});

describe("median", () => {
  it("takes the middle one, whatever the order", () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([])).toBe(0);
  });
});

describe("the world of the cases", () => {
  it("reads the sample tickets at the fixed clock: INC-20311 is overdue", () => {
    const ticket = createWorld().tickets.find((one) => one.id === "INC-20311");
    expect(new Date(ticket!.dueAt).getTime()).toBeLessThan(NOW.getTime());
  });

  it("answers a ticket of someone else as one that does not exist", async () => {
    const { desk } = createWorld();
    expect(await desk.getTicket("INC-20319", "emp-ana")).toEqual({ ok: true, data: null });
  });

  it.each([
    [6, ["INC-20150", "INC-20298"]],
    [8, ["INC-20298"]],
  ])("counts a ticket resolved %i days ago as a candidate only within the 7 days", async (resolvedAgoDays, expected) => {
    const { desk } = createWorld({ resolved: [{ id: "INC-20150", resolvedAgoDays }] });
    const candidates = await desk.listCandidates("emp-ana", "access");
    expect(candidates.ok && candidates.data.map((ticket) => ticket.id).sort()).toEqual(expected);
  });
});

describe("the checks of the cases", () => {
  const overdue = caseNamed("Chamado vencido vai para o N2");
  const duplicate = caseNamed("Duplicado vira o chamado que já existe");
  const lookup = { toolCalls: [{ toolName: "getTicket", input: { ticketId: "INC-20311" } }] };
  const transfer = (ticketId?: string) => ({
    toolCalls: [{ toolName: "transferToAnalyst", input: { reason: "employee_request", summary: "Notebook lento há 6 dias, e a Ana pediu um analista.", ticketId } }],
  });

  it("pass when the agent does what the rule says", async () => {
    const model = scriptedModel([decide, lookup, { text: "Está vencido." }, decide, transfer("INC-20311"), { text: "Encaminhei." }]);
    expect(await runOnce(overdue, model)).toMatchObject({ passed: true, failure: null, retries: 0 });
  });

  it("fail when the transfer leaves the ticket out, which sends it to the wrong level", async () => {
    const model = scriptedModel([decide, lookup, { text: "Está vencido." }, decide, transfer(), { text: "Encaminhei." }]);
    expect((await runOnce(overdue, model)).passed).toBe(false);
  });

  it("fail when a reply does not start with its decision", async () => {
    const model = scriptedModel([lookup, { text: "Está vencido." }, decide, transfer("INC-20311"), { text: "Encaminhei." }]);
    const run = await runOnce(overdue, model);
    expect(run.passed).toBe(false);
  });

  it("do not pass a duplicate that never mentions the ticket it duplicates", async () => {
    const run = await runOnce(duplicate, scriptedModel([decide, { text: "Quem está sendo afetado?" }]));
    expect(run.failure).toContain("INC-20311");
  });
});

describe("renderReport", () => {
  it("writes the table, and what the model did in a case that did not pass", async () => {
    const good = summarize({ name: "Passa", rule: "Funcionário 1" }, [
      { passed: true, failure: null, replies: [], ms: 2000, cost: 0.001, retries: 0 },
    ]);
    const bad = summarize({ name: "Falha", rule: "Anexo A" }, [
      {
        passed: false,
        failure: "devia transferir",
        replies: [
          {
            text: "Vou abrir um chamado.",
            tools: [
              { name: "recordDecision", args: decision, result: {} },
              { name: "draftTicket", args: { operation: "create" }, result: {} },
            ],
            usage: {},
            ms: 1500,
          },
        ],
        ms: 1500,
        cost: 0.002,
        retries: 1,
      },
    ]);
    const report = renderReport([good, bad], { model: "anthropic/claude-haiku-5-5", at: NOW });
    expect(report).toContain("| Passa | Funcionário 1 | 1 de 1 |");
    expect(report).toContain("| Falha | Anexo A | 0 de 1 | 1,5 s | US$ 0,0020 |");
    expect(report).toContain("Passaram 1 de 2 casos. Custo total: US$ 0,0030.");
    expect(report).toContain("Rodada 1: devia transferir");
    expect(report).toContain('draftTicket {"operation":"create"}');
    expect(report).toContain("Vou abrir um chamado.");
  });
});
