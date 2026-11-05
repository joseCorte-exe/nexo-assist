import type { CaseResult, Reply, RunResult } from "./run";

// Cost, medians and the table of `pnpm eval`, written to docs/evals/resultado.md.

/** Prices of Claude Haiku 5.5, per million tokens (docs/features/5-transferencia-e-console/relatorio.md). */
export const PRICE_PER_MILLION = { input: 0.1, cacheRead: 0.01, output: 0.5 };

export type TokenUsage = { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number };

/**
 * What a reply cost. The input Mastra reports already counts what came from the cache. The report has no price for
 * writing to the cache, so what is written counts as plain input.
 */
export function costOf({ inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 }: TokenUsage): number {
  const { input, cacheRead, output } = PRICE_PER_MILLION;
  return ((inputTokens - cachedInputTokens) * input + cachedInputTokens * cacheRead + outputTokens * output) / 1_000_000;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const brazilian = (value: number, digits: number) => value.toFixed(digits).replace(".", ",");
export const dollars = (value: number) => `US$ ${brazilian(value, 4)}`;
export const seconds = (ms: number) => `${brazilian(ms / 1000, 1)} s`;

const MAX_DETAIL = 400;
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
const shorten = (text: string) => (text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text);

/** The tools of the replies, by name, one reply per item: what a person reads first to see what the model did. */
export const toolNames = (replies: Reply[]) => replies.map((reply) => reply.tools.map((tool) => tool.name).join(", ") || "nenhuma");

/** How many replies recorded their decision more than once, which the instructions say not to do. */
export function repeatedDecisions(results: CaseResult[]) {
  const replies = results.flatMap(({ runs }) => runs.flatMap((run) => run.replies));
  return {
    repeated: replies.filter((reply) => reply.tools.filter((tool) => tool.name === "recordDecision").length > 1).length,
    total: replies.length,
  };
}

function failedRun(run: RunResult, index: number) {
  const lines = [`- Rodada ${index + 1}: ${cell(run.failure ?? "")}`];
  for (const [turn, reply] of run.replies.entries()) {
    const tools = reply.tools
      .filter((tool) => tool.name !== "recordDecision")
      .map((tool) => `${tool.name} ${shorten(JSON.stringify(tool.args))}`);
    const decision = reply.tools.find((tool) => tool.name === "recordDecision")?.args as { confidence?: number } | undefined;
    lines.push(`  - Resposta ${turn + 1}, confiança ${decision?.confidence ?? "sem registro"}: ${tools.join("; ") || "nenhuma ferramenta além da decisão"}`);
    if (reply.text) lines.push(`  - Texto: ${shorten(reply.text.replaceAll("\n", " "))}`);
  }
  return lines;
}

/** The result of a whole `pnpm eval`, as docs/evals/resultado.md keeps it. */
export function renderReport(results: CaseResult[], { model, at }: { model: string; at: Date }) {
  const totalCost = results.reduce((sum, result) => sum + result.totalCost, 0);
  const passed = results.filter((result) => result.passes === result.runs.length).length;
  const retries = results.flatMap(({ runs }) => runs).reduce((sum, run) => sum + run.retries, 0);
  const { repeated, total } = repeatedDecisions(results);
  const failures = results.filter((result) => result.passes < result.runs.length);

  const lines = [
    "# Testes do agent com o modelo real",
    "",
    "Este arquivo é escrito pelo `pnpm eval`. Não edite à mão: rode de novo.",
    "",
    `Rodado em ${at.toISOString().slice(0, 10)}, com \`${model}\`. Cada caso roda ${results[0]?.runs.length ?? 0} vezes, e só passa se todas passarem. Os dados são os do seed, em memória, com o relógio parado numa segunda às 10:05. O tempo e o custo são da rodada inteira do caso, com todas as mensagens dela. Os casos rodam em sequência, então quase todas as chamadas leem as instruções do cache.`,
    "",
    `Preço por milhão de tokens: entrada US$ ${brazilian(PRICE_PER_MILLION.input, 2)}, leitura de cache US$ ${brazilian(PRICE_PER_MILLION.cacheRead, 2)}, saída US$ ${brazilian(PRICE_PER_MILLION.output, 2)}. A escrita no cache conta como entrada, porque o relatório da feature 5 não traz o preço dela.`,
    "",
    "| Caso | História ou regra | Passou | Tempo (mediana) | Custo (mediana) |",
    "|---|---|---|---|---|",
    ...results.map(
      (result) =>
        `| ${cell(result.name)} | ${cell(result.rule)} | ${result.passes} de ${result.runs.length} | ${seconds(result.medianMs)} | ${dollars(result.medianCost)} |`,
    ),
    "",
    `Passaram ${passed} de ${results.length} casos. Custo total: ${dollars(totalCost)}. Rodadas repetidas por erro do provedor ou tempo esgotado: ${retries}.`,
    "",
    `Em ${repeated} de ${total} respostas o modelo gravou a decisão mais de uma vez, embora as instruções peçam uma só.`,
  ];
  if (failures.length > 0) {
    lines.push("", "## O que o modelo fez nos casos que não passaram");
    for (const result of failures) {
      lines.push("", `### ${result.name} (${result.passes} de ${result.runs.length})`, "");
      result.runs.forEach((run, index) => {
        if (!run.passed) lines.push(...failedRun(run, index));
      });
    }
  }
  return `${lines.join("\n")}\n`;
}
