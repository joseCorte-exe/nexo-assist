import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import {
  type Affected,
  CATEGORY_LABEL,
  type Category,
  type DecisionRecord,
  type DraftTicketInput,
  draftTicketOutput,
  findTicketIds,
  getTicketOutput,
  type Impact,
  listMyTicketsOutput,
  type OutOfScopeArea,
  PRIORITY_LABEL,
  redirectOutOfScopeOutput,
  searchArticlesOutput,
  TICKET_STATUS_LABEL,
  type TicketSummary,
  type Urgency,
} from "@nexo/shared";
import { SCREEN_NOTE } from "../agent";
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
/** Something is broken, not a question: the way to a ticket. */
const PROBLEM = /\b(n[aã]o (conecta|funciona|liga|abre|imprime|entra|sincroniza)|parou|travou|travando|fora do ar|bloque\w*|lento|lentid[aã]o)\b/i;
/** The problem is back: a resolved ticket may be reopened. */
const CAME_BACK = /\b(de novo|novamente|voltou)\b/i;

/** The replies of the offer an overdue ticket gets, as the design shows them. */
const OVERDUE_REPLIES = ["Falar com um analista", "Adicionar informação", "Não, obrigado"];

/** The question that opens a ticket, with its replies, as "Chat — Novo chamado" shows them. */
const AFFECTED_QUESTION = "Quem está sendo afetado?";
const AFFECTED_REPLIES: Array<[string, Affected]> = [
  ["só eu", "only_me"],
  ["minha equipe", "my_team"],
  ["toda a empresa", "company"],
  ["não sei", "only_me"],
];
const ASK_AFFECTED = { toolName: "offerReplies", input: { question: AFFECTED_QUESTION, options: ["Só eu", "Minha equipe", "Toda a empresa", "Não sei"] } };

/** What the employee answers when clicking a reply of the offer. Calling an analyst is still the frank answer. */
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
const ASK_TO_ADD = /^O que você quer acrescentar ao ((?:INC|REQ)-\d{5})\?$/;

// The words of a problem, to tell the category and whether an open ticket is about the same thing.
const CATEGORY_WORDS: Array<[Category, RegExp]> = [
  ["network_vpn", /\b(vpn|wi-?fi|rede|internet)\b/],
  ["email", /\b(outlook|e-?mail|caixa de entrada)\b/],
  ["access", /\b(senha|acesso|login|bloque\w*|permiss\w*|sharepoint|sap)\b/],
  ["hardware", /\b(notebook|computador|teclado|mouse|monitor|impressora|tela|bateria)\b/],
  ["software", /\b(sistema|programa|teams|excel|instala\w*|licen\w*)\b/],
];
const SUBCATEGORIES: Array<[RegExp, string]> = [
  [/\bvpn\b/, "VPN"],
  [/\boutlook\b/, "Outlook"],
  [/\bsap\b/, "SAP"],
  [/\bsharepoint\b/, "SharePoint"],
  [/\bteclado\b/, "Teclado"],
  [/\bimpressora\b/, "Impressora"],
  [/\bmonitor\b/, "Monitor"],
  [/\bnotebook\b/, "Notebook"],
];
/** Words too common to say two problems are the same one. */
const COMMON_WORDS = new Set(
  "notebook computador celular desde ontem hoje cedo ainda muito agora sempre aparece continua problema quando porque depois antes para mais isso esta estou como tambem sobre novo nova voltou funciona conecta minha".split(" "),
);

const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const wordsOf = (text: string) => new Set(plain(text).match(/[a-z0-9]{4,}/g)?.filter((word) => !COMMON_WORDS.has(word)) ?? []);
const sameSubject = (a: string, b: string) => {
  const words = wordsOf(b);
  return [...wordsOf(a)].some((word) => words.has(word));
};

/** A ticket of the employee about the same thing as the text. */
const similar = <T extends { title: string }>(text: string, tickets: T[]) => tickets.find((ticket) => sameSubject(text, ticket.title));

type Intent =
  | { kind: "out_of_scope"; area: OutOfScopeArea; name: string }
  | { kind: "greeting" }
  | { kind: "offer_answer"; answer: (typeof OFFER_ANSWERS)[string] }
  | { kind: "ask_what_to_add"; ticketId: string | null }
  | { kind: "follow_up"; ticketId: string }
  | { kind: "draft"; problem: string; affected: Affected }
  | { kind: "ticket"; ticketId: string }
  | { kind: "came_back" }
  | { kind: "problem" }
  | { kind: "my_tickets" }
  | { kind: "help_center" };

type ToolCall = { toolName: string; input: unknown };
/** The turn before this one: what the employee said and what the agent did and wrote. */
type PreviousTurn = { said: string | null; toolCalls: ToolCall[]; text: string };

function intentOf(question: string, previous: PreviousTurn): Intent {
  const answer = question.trim().toLowerCase();
  const offered = previous.toolCalls.find((call) => call.toolName === "offerReplies")?.input as { question?: string } | undefined;

  // An answer to the question that opens a ticket (one of its replies, maybe with more said): the problem is what the
  // employee said before it. Anything else is a new subject.
  const affected = AFFECTED_REPLIES.find(([words]) => answer.startsWith(words))?.[1];
  if (offered?.question === AFFECTED_QUESTION && previous.said && affected) {
    return { kind: "draft", problem: previous.said, affected };
  }
  const asked = previous.text.trim().match(ASK_TO_ADD);
  if (asked?.[1]) return { kind: "follow_up", ticketId: asked[1] };
  // A click in an offer and a ticket number come first: a title chosen from the list can carry words of another area.
  if (answer === "adicionar informação") {
    const looked = previous.toolCalls.find((call) => call.toolName === "getTicket")?.input as { ticketId?: string } | undefined;
    return { kind: "ask_what_to_add", ticketId: looked?.ticketId ?? null };
  }
  const offerAnswer = OFFER_ANSWERS[answer];
  if (offerAnswer) return { kind: "offer_answer", answer: offerAnswer };
  const [ticketId] = findTicketIds(question);
  if (ticketId) return { kind: "ticket", ticketId };
  const area = AREAS.find(({ words }) => words.test(question));
  if (area) return { kind: "out_of_scope", area: area.area, name: area.name };
  if (GREETING.test(question)) return { kind: "greeting" };
  if (CAME_BACK.test(question) && PROBLEM.test(question)) return { kind: "came_back" };
  if (PROBLEM.test(question)) return { kind: "problem" };
  if (TICKET_WORDS.test(question)) return { kind: "my_tickets" };
  return { kind: "help_center" };
}

const userText = (message: LanguageModelV4Prompt[number] | undefined) =>
  message?.role === "user" ? message.content.map((part) => (part.type === "text" ? part.text : "")).join(" ") : "";
const isEmployeeMessage = (message: LanguageModelV4Prompt[number] | undefined) =>
  message?.role === "user" && !userText(message).startsWith(SCREEN_NOTE);

type TurnState = {
  question: string;
  /** The last result of each tool that ran in this turn. */
  results: Map<string, unknown>;
  /** Every result of draftTicket in this turn, in order: a create refused as a possible duplicate, then the update. */
  drafts: unknown[];
  previous: PreviousTurn;
};

/** The last employee message, the results of the tools that already ran in this turn, and the turn before it. */
function readTurn(prompt: LanguageModelV4Prompt): TurnState {
  let lastUser = prompt.length - 1;
  while (lastUser >= 0 && !isEmployeeMessage(prompt[lastUser])) lastUser--;
  const question = userText(prompt[lastUser]);

  const results = new Map<string, unknown>();
  const drafts: unknown[] = [];
  for (const message of prompt.slice(lastUser + 1)) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result" || part.output.type !== "json") continue;
      results.set(part.toolName, part.output.value);
      if (part.toolName === "draftTicket") drafts.push(part.output.value);
    }
  }

  let before = lastUser - 1;
  while (before >= 0 && !isEmployeeMessage(prompt[before])) before--;
  const previous: PreviousTurn = { said: before >= 0 ? userText(prompt[before]) : null, toolCalls: [], text: "" };
  for (const message of prompt.slice(before + 1, lastUser)) {
    if (message.role !== "assistant") continue;
    for (const part of message.content) {
      if (part.type === "text") previous.text += part.text;
      else if (part.type === "tool-call") previous.toolCalls.push({ toolName: part.toolName, input: part.input });
    }
  }
  return { question, results, drafts, previous };
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
    case "ask_what_to_add":
      return {
        understanding: `Quer acrescentar uma informação ao ${intent.ticketId ?? "chamado"}`,
        action: "Perguntar o que acrescentar",
        confidence: 0.9,
        reason: "Para montar o complemento, preciso da informação nova.",
      };
    case "follow_up":
      return {
        understanding: `Mandou a informação nova do ${intent.ticketId}`,
        action: `Montar o complemento do ${intent.ticketId} para conferir`,
        confidence: 0.9,
        reason: "O complemento só é enviado depois que o funcionário confirmar.",
      };
    case "draft":
      return {
        understanding: "Respondeu quem é afetado pelo problema",
        action: "Montar o rascunho do chamado para conferir",
        confidence: 0.88,
        reason: "Já sei o problema, quem é afetado e se há compromisso hoje; a prioridade sai da regra.",
      };
    case "ticket":
      return {
        understanding: `Quer saber como está o ${intent.ticketId}`,
        action: `Consultar o ${intent.ticketId} e calcular o prazo`,
        confidence: 0.92,
        reason: "O número do chamado está na mensagem.",
      };
    case "came_back":
      return {
        understanding: "Um problema que já tinha sido resolvido voltou",
        action: "Procurar o chamado resolvido para reabrir",
        confidence: 0.85,
        reason: "Um chamado resolvido há até 7 dias é reaberto em vez de abrir outro.",
      };
    case "problem":
      return {
        understanding: `Problema de TI: ${question.trim().slice(0, 120)}`,
        action: "Conferir os chamados abertos e a central de ajuda antes de abrir um chamado",
        confidence: 0.85,
        reason: "Antes de abrir um chamado, vejo se já existe um sobre isso e se a central de ajuda resolve.",
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
    const question = `Está sem atualização há ${days}, acima do prazo de ${ticket.deadline} para prioridade ${priority}. Quer que eu chame um analista?`;
    return { toolCalls: [{ toolName: "offerReplies", input: { question, options: OVERDUE_REPLIES } }] };
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
  const question = `Você tem ${tickets.length} chamados abertos. Sobre qual deles quer saber?`;
  return { toolCalls: [{ toolName: "offerTicketChoice", input: { question, ticketIds: tickets.map((ticket) => ticket.id) } }] };
}

/** A problem on its way to a ticket: say what the open tickets and the help center showed, and ask who is affected. */
function askAffected(question: string, results: Map<string, unknown>): ModelStep {
  const list = listMyTicketsOutput.safeParse(results.get("listMyTickets"));
  const search = searchArticlesOutput.safeParse(results.get("searchArticles"));
  // Without knowing her tickets or the help center, nothing is offered: it says what did not answer.
  if (!search.success || !search.data.ok) return { text: answerFromSearch(results.get("searchArticles")) };
  if (!list.success || !list.data.ok) return { text: TICKETS_DOWN };
  const open = list.data.tickets;
  const article = search.data.articles[0];
  const same = similar(question, open);
  const text = same
    ? `Você já tem o ${same.id} aberto sobre algo parecido.`
    : article
      ? `Não há chamado aberto sobre isso, e o artigo "${article.title}" da central de ajuda não resolveu. Vou abrir um chamado.`
      : "Não há chamado aberto sobre isso, e a central de ajuda não tem nada sobre o caso. Vou abrir um chamado.";
  return { text, toolCalls: [ASK_AFFECTED] };
}

/** What RN-01 needs, read from the words of the problem and of the answer. */
function newTicket(problem: string, answer: string, affected: Affected): DraftTicketInput {
  const text = plain(problem);
  const category = CATEGORY_WORDS.find(([, words]) => words.test(text))?.[0] ?? "other";
  const impact: Impact = PROBLEM.test(problem)
    ? /lento|lentid/.test(text)
      ? "degraded"
      : "stopped"
    : /\b(preciso de (um|uma)|solicit\w*|gostaria de|licen\w*|instalar)\b/.test(text)
      ? "request"
      : "degraded";
  const urgency: Urgency = /\bhoje\b|reuni[aã]o|\b\d{1,2}h\b|\b\d{1,2}:\d{2}\b|urgente/i.test(`${problem} ${answer}`) ? "same_day" : "none";
  const firstSentence = problem.split(/[.!?]/)[0]?.trim().replace(/^(meu|minha|o|a)\s+/i, "") ?? problem;
  const title = (firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1)).slice(0, 90);
  return {
    operation: "create",
    title,
    description: `${problem.trim()} ${answer.trim()}`,
    category,
    subcategory: SUBCATEGORIES.find(([words]) => words.test(text))?.[1] ?? null,
    impact,
    urgency,
    affected,
  };
}

/**
 * Drafting a new ticket: try it, and when the code finds open tickets of the category, follow up the one about the
 * same thing or say why this is another problem.
 */
function draftStep(intent: Extract<Intent, { kind: "draft" }>, answer: string, drafts: unknown[]): ModelStep {
  const ticket = newTicket(intent.problem, answer, intent.affected);
  const last = drafts.at(-1);
  if (last === undefined) return { toolCalls: [{ toolName: "draftTicket", input: ticket }] };
  const result = draftTicketOutput.safeParse(last);
  if (!result.success) return { text: TICKETS_DOWN };
  if (result.data.ok) return { text: lineAboveTheCard(result.data, drafts.length > 1, ticket) };
  if (result.data.reason !== "possible_duplicate") return { text: TICKETS_DOWN };

  const candidates: TicketSummary[] = result.data.candidates ?? [];
  const same = similar(intent.problem, candidates);
  if (same) {
    // The same problem: an open ticket gets the information, one resolved in the last days is reopened.
    const operation = same.status === "resolved" ? "reopen" : "update";
    return { toolCalls: [{ toolName: "draftTicket", input: { operation, ticketId: same.id, description: intent.problem.trim() } }] };
  }
  const notDuplicateReason = `Os chamados abertos de ${CATEGORY_LABEL[ticket.category!].toLowerCase()} tratam de outro problema: ${candidates.map((one) => one.id).join(", ")}.`;
  return { toolCalls: [{ toolName: "draftTicket", input: { ...ticket, notDuplicateReason } }] };
}

/** Why RN-01 gave that priority, in the words of what the employee said. */
function priorityReason(ticket: DraftTicketInput | undefined) {
  if (ticket?.urgency === "same_day") return " por causa do compromisso de hoje";
  if (ticket?.impact === "stopped" && ticket.affected !== "only_me") return " porque está parado para mais gente";
  return "";
}

/** The sentence above the card: what was decided and why, with the deadline the tool computed. */
function lineAboveTheCard(
  { draft, dueText }: { draft: { operation: string; ticketId: string | null; priority: keyof typeof PRIORITY_LABEL }; dueText: string },
  afterDuplicate: boolean,
  ticket?: DraftTicketInput,
) {
  if (draft.operation === "reopen") return `O ${draft.ticketId} foi resolvido há pouco e ainda pode ser reaberto. Confira antes de eu reabrir:`;
  if (draft.operation === "update") {
    return afterDuplicate
      ? `Já existe o ${draft.ticketId} sobre isso, então vou acrescentar a informação a ele. Confira antes de eu enviar:`
      : `Confira o que vou acrescentar ao ${draft.ticketId} antes de eu enviar:`;
  }
  const priority = PRIORITY_LABEL[draft.priority].toLowerCase();
  return `Coloquei prioridade ${priority}${priorityReason(ticket)}: a resposta chega ${dueText}. Confira antes de eu criar:`;
}

/** The problem is back: reopen the resolved ticket about it; past the 7 days, start a new one. */
function cameBackStep(question: string, results: Map<string, unknown>): ModelStep {
  if (results.has("draftTicket")) {
    const result = draftTicketOutput.safeParse(results.get("draftTicket"));
    if (!result.success) return { text: TICKETS_DOWN };
    if (result.data.ok) return { text: lineAboveTheCard(result.data, false) };
    if (result.data.reason === "reopen_window_closed") {
      const [ticketId] = findTicketIds(result.data.message);
      return { text: `O ${ticketId} foi resolvido há mais de 7 dias e não pode ser reaberto. Vou abrir um chamado novo.`, toolCalls: [ASK_AFFECTED] };
    }
    return { text: TICKETS_DOWN };
  }
  if (!results.has("listMyTickets")) return { toolCalls: [{ toolName: "listMyTickets", input: { scope: "all" } }] };
  const list = listMyTicketsOutput.safeParse(results.get("listMyTickets"));
  if (!list.success || !list.data.ok) return { text: TICKETS_DOWN };
  const resolved = similar(question, list.data.tickets.filter((ticket) => ticket.status === "resolved"));
  if (!resolved) return { text: "Não achei um chamado seu resolvido sobre isso. Vou abrir um chamado.", toolCalls: [ASK_AFFECTED] };
  return { toolCalls: [{ toolName: "draftTicket", input: { operation: "reopen", ticketId: resolved.id, description: question.trim() } }] };
}

function followUpStep(ticketId: string, question: string, results: Map<string, unknown>): ModelStep {
  if (!results.has("draftTicket")) {
    return { toolCalls: [{ toolName: "draftTicket", input: { operation: "update", ticketId, description: question.trim() } }] };
  }
  const result = draftTicketOutput.safeParse(results.get("draftTicket"));
  if (!result.success) return { text: TICKETS_DOWN };
  return { text: result.data.ok ? lineAboveTheCard(result.data, false) : result.data.message };
}

function nextStep({ prompt }: LanguageModelV4CallOptions): ModelStep {
  const { question, results, drafts, previous } = readTurn(prompt);
  const intent = intentOf(question, previous);
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
    case "ask_what_to_add":
      return { text: intent.ticketId ? `O que você quer acrescentar ao ${intent.ticketId}?` : "A qual chamado você quer acrescentar uma informação?" };
    case "follow_up":
      return followUpStep(intent.ticketId, question, results);
    case "draft":
      return draftStep(intent, question, drafts);
    case "came_back":
      return cameBackStep(question, results);
    case "problem":
      return results.has("listMyTickets")
        ? askAffected(question, results)
        : {
            toolCalls: [
              { toolName: "listMyTickets", input: { scope: "open" } },
              { toolName: "searchArticles", input: { query: question.slice(0, 200) } },
            ],
          };
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
