import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import {
  type DecisionRecord,
  findTicketIds,
  getTicketOutput,
  listMyTicketsOutput,
  type OutOfScopeArea,
  PRIORITY_LABEL,
  redirectOutOfScopeOutput,
  searchArticlesOutput,
  TICKET_STATUS_LABEL,
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
const TICKET_WORDS = /\b(chamados?|status|andamento)\b/i;

/** The replies of the offer an overdue ticket gets, as the design shows them. */
const OVERDUE_REPLIES = ["Falar com um analista", "Adicionar informação", "Não, obrigado"];

/** What the employee answers when clicking a reply of the offer, and the frank answer while it is not built yet. */
const OFFER_ANSWERS: Record<string, { decision: DecisionRecord; text: string }> = {
  "falar com um analista": {
    decision: {
      understanding: "Quer falar com um analista",
      action: "Explicar que a transferência ainda não está disponível pelo chat",
      confidence: 0.9,
      reason: "A transferência para um analista ainda não está disponível no chat.",
    },
    text: "Ainda não consigo chamar um analista por aqui. Se for urgente, ligue no ramal 4000.",
  },
  "adicionar informação": {
    decision: {
      understanding: "Quer acrescentar informações ao chamado",
      action: "Explicar que o complemento ainda não está disponível pelo chat",
      confidence: 0.9,
      reason: "Complementar um chamado ainda não está disponível no chat.",
    },
    text: "Ainda não consigo acrescentar informações ao chamado por aqui. Se for urgente, ligue no ramal 4000.",
  },
  "não, obrigado": {
    decision: {
      understanding: "Não quer mais nada sobre o chamado",
      action: "Encerrar o assunto com cordialidade",
      confidence: 0.95,
      reason: "O funcionário recusou a oferta.",
    },
    text: "Tudo bem. Se precisar de mais alguma coisa, é só escrever.",
  },
};

const TICKETS_DOWN = "O serviço de chamados não respondeu agora. Tente de novo em instantes.";

type Intent =
  | { kind: "out_of_scope"; area: OutOfScopeArea; name: string }
  | { kind: "greeting" }
  | { kind: "offer_answer"; answer: (typeof OFFER_ANSWERS)[string] }
  | { kind: "ticket"; ticketId: string }
  | { kind: "my_tickets" }
  | { kind: "help_center" };

function intentOf(question: string): Intent {
  const area = AREAS.find(({ words }) => words.test(question));
  if (area) return { kind: "out_of_scope", area: area.area, name: area.name };
  if (GREETING.test(question)) return { kind: "greeting" };
  const answer = OFFER_ANSWERS[question.trim().toLowerCase()];
  if (answer) return { kind: "offer_answer", answer };
  const [ticketId] = findTicketIds(question);
  if (ticketId) return { kind: "ticket", ticketId };
  if (TICKET_WORDS.test(question)) return { kind: "my_tickets" };
  return { kind: "help_center" };
}

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

function decide(intent: Intent, question: string): DecisionRecord {
  switch (intent.kind) {
    case "out_of_scope":
      return {
        understanding: `Assunto de ${intent.name}, que não é de TI`,
        action: `Indicar o canal de ${intent.name}`,
        confidence: 0.95,
        reason: `Assuntos de ${intent.name} são tratados por outra equipe, e a central de ajuda tem o canal.`,
      };
    case "greeting":
      return {
        understanding: "Cumprimento, sem um problema ainda",
        action: "Perguntar como posso ajudar",
        confidence: 0.9,
        reason: "Ainda não há um pedido para atender.",
      };
    case "offer_answer":
      return intent.answer.decision;
    case "ticket":
      return {
        understanding: `Quer saber como está o ${intent.ticketId}`,
        action: `Consultar o ${intent.ticketId} e calcular o prazo`,
        confidence: 0.92,
        reason: "O número do chamado está na mensagem.",
      };
    case "my_tickets":
      return {
        understanding: "Quer saber como está um chamado, sem dizer o número",
        action: "Consultar os chamados do funcionário",
        confidence: 0.88,
        reason: "Sem o número, preciso ver quais chamados estão abertos.",
      };
    case "help_center":
      return {
        understanding: `Dúvida de TI: ${question.trim().slice(0, 120)}`,
        action: "Buscar na central de ajuda",
        confidence: 0.82,
        reason: "A central de ajuda pode ter a resposta sem precisar abrir um chamado.",
      };
  }
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

/** The card is on the screen already: the text says what it means, and an overdue ticket gets the offer. */
function answerFromTicket(value: unknown): ModelStep {
  const result = getTicketOutput.safeParse(value);
  if (!result.success) return { text: TICKETS_DOWN };
  if (!result.data.ok) {
    return {
      text:
        result.data.reason === "not_found"
          ? `${result.data.message} Confira o número ou me conte do que se trata.`
          : TICKETS_DOWN,
    };
  }
  const { ticket } = result.data;
  if (ticket.overdue) {
    const days = ticket.daysSinceUpdate === 1 ? "1 dia" : `${ticket.daysSinceUpdate} dias`;
    const priority = PRIORITY_LABEL[ticket.priority].toLowerCase();
    return {
      text: `Está sem atualização há ${days}, acima do prazo de ${ticket.deadline} para prioridade ${priority}. Quer que eu chame um analista?`,
      toolCalls: [{ toolName: "offerReplies", input: { options: OVERDUE_REPLIES } }],
    };
  }
  const status = TICKET_STATUS_LABEL[ticket.status].toLowerCase();
  const situation = ticket.status === "resolved" ? `O ${ticket.id} foi resolvido.` : `O ${ticket.id} está ${status}, dentro do prazo.`;
  const note = ticket.lastItUpdate ? ` A última atualização da TI: "${ticket.lastItUpdate}"` : "";
  return { text: situation + note };
}

/** Without a number: none open, look the only one up, or ask which one with the list. */
function stepFromList(value: unknown): ModelStep {
  const result = listMyTicketsOutput.safeParse(value);
  if (!result.success || !result.data.ok) return { text: TICKETS_DOWN };
  const { tickets } = result.data;
  const [only] = tickets;
  if (!only) return { text: "Você não tem chamados abertos agora." };
  if (tickets.length === 1) return { toolCalls: [{ toolName: "getTicket", input: { ticketId: only.id } }] };
  return {
    text: `Você tem ${tickets.length} chamados abertos. Sobre qual deles quer saber?`,
    toolCalls: [{ toolName: "offerTicketChoice", input: { ticketIds: tickets.map((ticket) => ticket.id) } }],
  };
}

function nextStep({ prompt }: LanguageModelV4CallOptions): ModelStep {
  const { question, results } = readTurn(prompt);
  const intent = intentOf(question);
  if (!results.has("recordDecision")) {
    return { toolCalls: [{ toolName: "recordDecision", input: decide(intent, question) }] };
  }

  switch (intent.kind) {
    case "out_of_scope":
      return results.has("redirectOutOfScope")
        ? { text: answerFromRedirect(results.get("redirectOutOfScope")) }
        : { toolCalls: [{ toolName: "redirectOutOfScope", input: { area: intent.area } }] };
    case "greeting":
      return { text: "Oi! Como posso ajudar? Me conte o que está acontecendo." };
    case "offer_answer":
      return { text: intent.answer.text };
    case "ticket":
      return results.has("getTicket")
        ? answerFromTicket(results.get("getTicket"))
        : { toolCalls: [{ toolName: "getTicket", input: { ticketId: intent.ticketId } }] };
    case "my_tickets":
      if (results.has("getTicket")) return answerFromTicket(results.get("getTicket"));
      return results.has("listMyTickets")
        ? stepFromList(results.get("listMyTickets"))
        : { toolCalls: [{ toolName: "listMyTickets", input: { scope: "open" } }] };
    case "help_center":
      return results.has("searchArticles")
        ? { text: answerFromSearch(results.get("searchArticles")) }
        : { toolCalls: [{ toolName: "searchArticles", input: { query: question.slice(0, 200) } }] };
  }
}

/** Text arrives word by word with a short pause, so the screen shows the reply arriving as with the real model. */
export function simulatedModel({ delayMs = 0 }: { delayMs?: number } = {}) {
  return codedModel("simulated", nextStep, { delayMs });
}
