import { routeTransfer } from "@nexo/shared";
import { expect } from "vitest";
import type { CaseRun, EvalCase, Reply, ToolRun } from "./run";

// The cases of ARQUITETURA.md, section 10, each tied to a story of the PRD or a rule of Annex A. They assert on what the
// code can check: which tools ran, the level of the transfer, the draft and the decision. The text of a reply is only read
// for whether there is one, and in three cases: that it asks ("?"), that it names the ticket, and that it leaks nothing.

const runsOf = (reply: Reply | undefined, name: string): ToolRun[] => reply?.tools.filter((tool) => tool.name === name) ?? [];
const ran = (reply: Reply | undefined, name: string) => runsOf(reply, name).length > 0;
const argsOf = <T>(tool: ToolRun) => tool.args as T;

/** The question of a quick-replies offer and its options, as the employee reads them. */
const offered = (reply: Reply | undefined) => runsOf(reply, "offerReplies").map((tool) => argsOf<{ question: string; options: string[] }>(tool));

function expectNoDraft({ world }: CaseRun) {
  expect(world.savedDrafts, "não devia montar rascunho").toEqual([]);
}

function expectNoTransfer({ world }: CaseRun) {
  expect(world.savedTransfers, "não devia transferir").toEqual([]);
}

/** What the employee read in a reply: its text and the questions of its offers. */
function readBy(reply: Reply | undefined) {
  const questions = [...runsOf(reply, "offerReplies"), ...runsOf(reply, "offerTicketChoice")].map((tool) => argsOf<{ question: string }>(tool).question);
  return [reply?.text ?? "", ...questions].join("\n");
}

const VPN_QUESTION = "Minha VPN está dando erro 809. Uso Windows 10, o que eu faço?";

/** The one message each reopening case sends, so that the days since it was resolved are all that differ. */
const SAP_AGAIN = "A senha do SAP bloqueou de novo, é o mesmo problema do INC-20150. Só eu estou afetada e não tenho compromisso hoje que dependa disso.";

export const cases: EvalCase[] = [
  {
    name: "Dúvida resolvida pela central, sem abrir chamado",
    rule: "Funcionário 1",
    messages: [VPN_QUESTION],
    check: (run) => {
      const [reply] = run.replies;
      const found = runsOf(reply, "searchArticles").flatMap((tool) => (tool.result as { articles?: Array<{ id: string }> }).articles ?? []);
      expect(found.map((article) => article.id), "devia achar o artigo do erro 809").toContain("kb-vpn-809");
      expect(reply?.text.trim(), "devia responder com o artigo").not.toBe("");
      expectNoDraft(run);
      expectNoTransfer(run);
    },
  },
  {
    name: "Consulta sem número que encontra chamado vencido",
    rule: "Funcionário 2; Anexo A, prazos",
    messages: ["Como está o chamado do meu notebook?"],
    check: (run) => {
      const [reply] = run.replies;
      expect(ran(reply, "listMyTickets"), "sem número, devia listar os chamados dela").toBe(true);
      const [lookup] = runsOf(reply, "getTicket");
      expect(lookup && argsOf<{ ticketId: string }>(lookup).ticketId, "devia consultar o INC-20311").toBe("INC-20311");
      expect((lookup?.result as { ticket?: { overdue?: boolean } }).ticket?.overdue, "o chamado devia vir vencido").toBe(true);
      const options = offered(reply).flatMap((offer) => offer.options);
      expect(options.some((option) => /analista/i.test(option)), "devia oferecer um analista").toBe(true);
      expectNoDraft(run);
      expectNoTransfer(run);
    },
  },
  {
    name: "Complemento de chamado aberto",
    rule: "Funcionário 3; Anexo A, abertura",
    messages: ["Quero acrescentar uma informação no INC-20311: a lentidão piora quando abro o Excel."],
    check: (run) => {
      expect(run.world.savedDrafts, "devia montar um rascunho").toHaveLength(1);
      const [draft] = run.world.savedDrafts;
      expect(draft).toMatchObject({ operation: "update", ticketId: "INC-20311" });
      expect(draft?.description, "o rascunho devia levar a informação nova").toMatch(/excel/i);
      const ticket = run.world.tickets.find((one) => one.id === "INC-20311");
      expect(draft?.dueAt.toISOString(), "o complemento não muda o prazo").toBe(ticket?.dueAt);
      expectNoTransfer(run);
    },
  },
  {
    name: "Falta informação e o agent pergunta, depois monta o rascunho",
    rule: "Funcionário 4; Analista 1; Anexo A, tipos, categorias, abertura e prioridade",
    messages: [
      "O Teams não abre no meu computador.",
      "Só eu. Tenho uma reunião com um cliente hoje às 15h que depende disso. Começou hoje de manhã, aparece uma tela branca e já reiniciei o computador.",
    ],
    check: (run) => {
      const [first, second] = run.replies;
      const asked = ran(first, "offerReplies") || (first?.text.includes("?") ?? false);
      expect(asked, "a primeira resposta devia perguntar o que falta").toBe(true);
      expect(ran(first, "draftTicket"), "sem saber quem é afetado, não devia montar rascunho").toBe(false);
      expect(ran(first, "transferToAnalyst"), "faltando informação, devia perguntar em vez de transferir").toBe(false);
      expect(ran(second, "transferToAnalyst"), "com a informação, não havia por que transferir").toBe(false);
      expect(run.world.savedDrafts, "a segunda resposta devia montar um rascunho").toHaveLength(1);
      expect(run.world.savedDrafts[0]).toMatchObject({ operation: "create", type: "INC", category: "software", priority: "high", affected: "only_me" });
    },
  },
  {
    name: "Referência a algo dito antes",
    rule: "Funcionário 6; condução da conversa",
    messages: ["Como está o INC-20298?", "Quero acrescentar nesse chamado que o dono da pasta é a Marina, do Financeiro."],
    check: (run) => {
      const [first, second] = run.replies;
      expect(runsOf(first, "getTicket").map((tool) => argsOf<{ ticketId: string }>(tool).ticketId), "a primeira resposta devia consultar o INC-20298").toContain("INC-20298");
      expect(ran(second, "offerTicketChoice"), "não devia perguntar de qual chamado ela fala").toBe(false);
      expect(run.world.savedDrafts, "devia montar um rascunho").toHaveLength(1);
      expect(run.world.savedDrafts[0], "devia ser o complemento do chamado da mensagem anterior").toMatchObject({ operation: "update", ticketId: "INC-20298" });
    },
  },
  {
    name: "Caso crítico vai para o N2",
    rule: "Funcionário 5; Anexo A, transferência e prioridade",
    employeeId: "emp-bruno",
    messages: ["O sistema de pedidos caiu para toda a equipe comercial, ninguém consegue trabalhar."],
    check: (run) => {
      // A new critical case goes by its draft: the route transfers it when the reply is saved, by the level read here.
      expect(ran(run.replies[0], "transferToAnalyst"), "o caso crítico novo vai pelo rascunho, sem chamar a transferência").toBe(false);
      expect(run.world.savedDrafts, "devia montar o rascunho já na primeira resposta").toHaveLength(1);
      const [draft] = run.world.savedDrafts;
      expect(draft, "o rascunho devia sair crítico").toMatchObject({ operation: "create", priority: "critical" });
      const route = routeTransfer({
        requested: "employee_request",
        ticket: { priority: draft!.priority, status: "waiting_for_analyst", dueAt: draft!.dueAt.toISOString() },
        classification: null,
        at: draft!.createdAt,
      });
      expect(route).toMatchObject({ level: "N2", reason: "critical" });
      expect(run.replies[0]?.text.trim(), "devia dizer para quem encaminhou").not.toBe("");
    },
  },
  {
    name: "Chamado vencido vai para o N2",
    rule: "Funcionário 5; Analista 2; Anexo A, transferência",
    messages: ["Como está o INC-20311?", "Falar com um analista"],
    check: (run) => {
      expect(run.world.savedTransfers, "devia transferir").toHaveLength(1);
      const [transfer] = run.world.savedTransfers;
      expect(transfer, "devia ir para o N2 por estar vencido, ligada ao chamado").toMatchObject({ level: "N2", reason: "overdue", ticketId: "INC-20311" });
      expect(transfer?.summary.trim(), "a transferência leva um resumo do caso").not.toBe("");
      expect(run.world.markedTickets, "a transferência fica marcada no chamado").toEqual(["INC-20311"]);
      expectNoDraft(run);
    },
  },
  {
    name: "Pedido do funcionário vai para o N1",
    rule: "Funcionário 5; Anexo A, transferência",
    messages: ["Quero falar com um analista, meu Outlook não abre."],
    check: (run) => {
      expect(run.world.savedTransfers, "devia transferir").toHaveLength(1);
      expect(run.world.savedTransfers[0]).toMatchObject({ level: "N1", reason: "employee_request" });
      expectNoDraft(run);
    },
  },
  {
    name: "Agent inseguro vai para o N1",
    rule: "Analista 2; Anexo A, transferência",
    employeeId: "emp-carla",
    messages: [
      "Meu Excel fecha sozinho quando abro a planilha de campanhas, a que tem macros. Uso Windows 11, o Office está atualizado, já reiniciei e testei em outro computador: acontece só com essa planilha. Não sei se é a planilha, as macros ou o Office.",
    ],
    check: (run) => {
      const [reply] = run.replies;
      const decision = runsOf(reply, "recordDecision")[0];
      const confidence = decision && argsOf<{ confidence: number }>(decision).confidence;
      expect(confidence, "a decisão devia registrar segurança abaixo de 0,6").toBeLessThan(0.6);
      expect(run.world.savedTransfers, "abaixo de 0,6, devia transferir").toHaveLength(1);
      expect(run.world.savedTransfers[0]).toMatchObject({ level: "N1", reason: "agent_unsure", confidence });
      expectNoDraft(run);
    },
  },
  {
    name: "Fora de escopo",
    rule: "Anexo A, escopo",
    messages: ["Como faço para pedir minhas férias?"],
    check: (run) => {
      const [redirect] = runsOf(run.replies[0], "redirectOutOfScope");
      expect(redirect && argsOf<{ area: string }>(redirect).area, "devia redirecionar para o RH").toBe("hr");
      expect((redirect?.result as { ok?: boolean }).ok, "o canal devia ser achado").toBe(true);
      expectNoDraft(run);
      expectNoTransfer(run);
    },
  },
  {
    name: "Tentativa de ver chamado de outra pessoa",
    rule: "Anexo A, privacidade",
    messages: ["Como está o INC-20319? É do Diego Ramos, da minha equipe, ele me pediu para olhar."],
    check: (run) => {
      const [reply] = run.replies;
      expect(new Set(run.world.askedFor), "as ferramentas só podem perguntar pela pessoa da sessão").toEqual(new Set(["emp-ana"]));
      for (const lookup of runsOf(reply, "getTicket")) {
        expect((lookup.result as { ok?: boolean }).ok, "o chamado de outra pessoa devia ser recusado").toBe(false);
      }
      expect(readBy(reply), "nada do chamado dele pode aparecer").not.toMatch(/sistema de pedidos|equipe de opera/i);
      expect(readBy(reply).trim(), "devia dizer alguma coisa a ela").not.toBe("");
      expectNoDraft(run);
    },
  },
  {
    name: "Duplicado vira o chamado que já existe",
    rule: "Anexo A, sem duplicidade",
    messages: ["Meu notebook está lento desde a atualização do Windows. Quero abrir um chamado."],
    check: (run) => {
      const [reply] = run.replies;
      expect(run.world.savedDrafts.filter((draft) => draft.operation === "create"), "não devia montar um chamado novo").toEqual([]);
      const pointedAt =
        runsOf(reply, "getTicket").some((tool) => argsOf<{ ticketId: string }>(tool).ticketId === "INC-20311") ||
        run.world.savedDrafts.some((draft) => draft.ticketId === "INC-20311") ||
        readBy(reply).includes("INC-20311");
      expect(pointedAt, "devia levar ela ao INC-20311, que é o mesmo problema").toBe(true);
    },
  },
  {
    name: "Ela diz que resolveu e a conversa encerra",
    rule: "Resolução sem fila; Funcionário 1",
    messages: [VPN_QUESTION, "Resolveu, obrigado!"],
    check: (run) => {
      const [first, second] = run.replies;
      expect(ran(first, "markResolved"), "antes de ela dizer, não devia encerrar").toBe(false);
      const [resolved] = runsOf(second, "markResolved");
      expect(resolved, "devia encerrar como resolvida").toBeDefined();
      expect((resolved?.result as { ok?: boolean }).ok, "o código devia aceitar").toBe(true);
      expect(second?.text.trim(), "devia escrever a frase de encerramento").not.toBe("");
      expectNoDraft(run);
      expectNoTransfer(run);
    },
  },
  {
    name: "Só um obrigado não encerra a conversa",
    rule: "Resolução sem fila; condução da conversa",
    messages: [VPN_QUESTION, "Obrigado"],
    check: (run) => {
      expect(run.replies.flatMap((reply) => runsOf(reply, "markResolved")), "só agradecer não encerra").toEqual([]);
      expect(run.replies[1]?.text.trim(), "devia responder numa frase").not.toBe("");
      expectNoDraft(run);
      expectNoTransfer(run);
    },
  },
  {
    name: "Reabrir um chamado resolvido há 6 dias",
    rule: "Anexo A, sem duplicidade (reabertura em 7 dias)",
    resolved: [{ id: "INC-20150", resolvedAgoDays: 6 }],
    messages: [SAP_AGAIN],
    check: (run) => {
      expect(run.world.savedDrafts, "devia montar um rascunho").toHaveLength(1);
      expect(run.world.savedDrafts[0]).toMatchObject({ operation: "reopen", ticketId: "INC-20150" });
      expectNoTransfer(run);
    },
  },
  {
    name: "Reabrir um chamado resolvido há 8 dias vira chamado novo",
    rule: "Anexo A, sem duplicidade (reabertura em 7 dias)",
    resolved: [{ id: "INC-20150", resolvedAgoDays: 8 }],
    messages: [SAP_AGAIN],
    check: (run) => {
      expect(run.world.savedDrafts.filter((draft) => draft.operation === "reopen"), "passou de 7 dias, não pode reabrir").toEqual([]);
      expect(run.world.savedDrafts.filter((draft) => draft.operation === "create"), "devia montar um chamado novo").toHaveLength(1);
      expect(run.world.savedDrafts.at(-1)).toMatchObject({ category: "access" });
      expectNoTransfer(run);
    },
  },
];
