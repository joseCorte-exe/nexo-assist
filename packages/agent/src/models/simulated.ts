import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import {
  type DecisionRecord,
  type OutOfScopeArea,
  redirectOutOfScopeOutput,
  searchArticlesOutput,
} from "@nexo/shared";
import { codedModel, type ModelStep } from "./stream";

// A stand-in for the LLM with fixed rules, for the end-to-end tests and for running the app without a key
// (NEXO_AGENT_MODEL=simulated). It goes through the real agent: same tools, memory, forced first step and stream.

const AREAS: Array<{ area: OutOfScopeArea; name: string; words: RegExp }> = [
  { area: "hr", name: "RH", words: /\b(rh|f[eé]rias|holerite|ponto|benef[ií]cios?)\b/i },
  { area: "finance", name: "financeiro", words: /\b(financeiro|reembolso|adiantamento|nota fiscal)\b/i },
  { area: "facilities", name: "facilities", words: /\b(facilities|ar-condicionado|limpeza|crach[aá]|reserva de sala)\b/i },
];
const GREETING = /^\s*(oi|ol[aá]|bom dia|boa tarde|boa noite)\b[\s,!.]*(bom dia|boa tarde|boa noite)?[\s!.]*$/i;

type TurnState = { question: string; results: Map<string, unknown> };

/** The last employee message and the results of the tools that already ran in this turn. */
function readTurn(prompt: LanguageModelV4Prompt): TurnState {
  let lastUser = prompt.length - 1;
  while (lastUser >= 0 && prompt[lastUser]?.role !== "user") lastUser--;
  const userMessage = prompt[lastUser];
  const question =
    userMessage?.role === "user"
      ? userMessage.content.map((part) => (part.type === "text" ? part.text : "")).join(" ")
      : "";
  const results = new Map<string, unknown>();
  for (const message of prompt.slice(lastUser + 1)) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result" && part.output.type === "json") results.set(part.toolName, part.output.value);
    }
  }
  return { question, results };
}

function decide(question: string): DecisionRecord {
  const area = AREAS.find(({ words }) => words.test(question));
  if (area) {
    return {
      understanding: `Assunto de ${area.name}, que não é de TI`,
      action: `Indicar o canal de ${area.name}`,
      confidence: 0.95,
      reason: `Assuntos de ${area.name} são tratados por outra equipe, e a central de ajuda tem o canal.`,
    };
  }
  if (GREETING.test(question)) {
    return {
      understanding: "Cumprimento, sem um problema ainda",
      action: "Perguntar como posso ajudar",
      confidence: 0.9,
      reason: "Ainda não há um pedido para atender.",
    };
  }
  return {
    understanding: `Dúvida de TI: ${question.trim().slice(0, 120)}`,
    action: "Buscar na central de ajuda",
    confidence: 0.82,
    reason: "A central de ajuda pode ter a resposta sem precisar abrir um chamado.",
  };
}

function answerFromSearch(value: unknown): string {
  const result = searchArticlesOutput.safeParse(value);
  if (!result.success || !result.data.ok) {
    return "A central de ajuda não respondeu agora. Tente de novo em instantes; se for urgente, ligue no ramal 4000.";
  }
  const [article] = result.data.articles;
  if (!article) {
    return "Não encontrei nada sobre isso na central de ajuda. Pode me contar mais detalhes, como o sistema e a mensagem que aparece?";
  }
  return `Encontrei na central de ajuda, em "${article.title}": ${article.content}`;
}

function answerFromRedirect(value: unknown): string {
  const result = redirectOutOfScopeOutput.safeParse(value);
  if (!result.success || !result.data.ok) {
    return "Esse assunto não é com a TI, e não consegui achar o canal agora. Tente de novo em instantes.";
  }
  return `Esse assunto não é com a TI. ${result.data.channel.content}`;
}

function nextStep({ prompt }: LanguageModelV4CallOptions): ModelStep {
  const { question, results } = readTurn(prompt);
  if (!results.has("recordDecision")) {
    return { toolCalls: [{ toolName: "recordDecision", input: decide(question) }] };
  }
  if (results.has("searchArticles")) return { text: answerFromSearch(results.get("searchArticles")) };
  if (results.has("redirectOutOfScope")) return { text: answerFromRedirect(results.get("redirectOutOfScope")) };

  const area = AREAS.find(({ words }) => words.test(question));
  if (area) return { toolCalls: [{ toolName: "redirectOutOfScope", input: { area: area.area } }] };
  if (GREETING.test(question)) return { text: "Oi! Como posso ajudar? Me conte o que está acontecendo." };
  return { toolCalls: [{ toolName: "searchArticles", input: { query: question.slice(0, 200) } }] };
}

/** Text arrives word by word with a short pause, so the screen shows the reply arriving as with the real model. */
export function simulatedModel({ delayMs = 0 }: { delayMs?: number } = {}) {
  return codedModel("simulated", nextStep, { delayMs });
}
