import { dueAt, type Priority } from "@nexo/shared";
import type { Db } from ".";
import { conversations, decisions, drafts, messages, usageCounters } from "./schema";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type SampleMessage = {
  author: "employee" | "agent" | "analyst" | "system";
  text: string;
  ago: number;
  decision?: { understanding: string; action: string; toolsUsed: string[]; confidence: number; reason: string };
};

type SampleConversation = {
  id: string;
  employeeId: string;
  state: "with_agent" | "waiting_for_analyst" | "with_analyst" | "closed";
  outcome?: "resolved_by_agent" | "closed_by_analyst";
  transfer?: {
    level: "N1" | "N2";
    reason: "employee_request" | "critical" | "overdue" | "agent_unsure";
    summary: string;
    ago: number;
    /** Priority whose deadline sets the wait. Without a linked ticket it counts as medium. */
    priority: Priority;
  };
  analystId?: string;
  ticketId?: string;
  closedAgo?: number;
  messages: SampleMessage[];
};

// One conversation for each state and console badge. First replies take 8 s on average, the number on the login screen. Ana has none, so the demo starts with her chat empty.
// TODO(design): messages and badges are placeholders until checked against nexo.pen.
const sampleConversations: SampleConversation[] = [
  {
    id: "conv-diego",
    employeeId: "emp-diego",
    state: "waiting_for_analyst",
    ticketId: "INC-20319",
    transfer: {
      level: "N2",
      reason: "critical",
      summary: "Sistema de pedidos fora do ar para toda a equipe de operações. Chamado crítico INC-20319 aberto.",
      ago: 35 * MINUTE,
      priority: "critical",
    },
    messages: [
      { author: "employee", text: "O sistema de pedidos caiu para toda a equipe de operações, ninguém consegue entrar.", ago: 40 * MINUTE },
      {
        author: "agent",
        text: "Isso parou a equipe inteira, então é um caso crítico. Abri o chamado INC-20319 e passei para um analista do N2, que entra em contato em até 1 hora.",
        ago: 40 * MINUTE - 9 * SECOND,
        decision: {
          understanding: "Sistema de pedidos fora do ar para a equipe de operações",
          action: "Abrir chamado crítico e transferir para o N2",
          toolsUsed: ["recordDecision", "listMyTickets", "draftTicket", "transferToAnalyst"],
          confidence: 0.92,
          reason: "Algo parado para uma equipe é prioridade crítica, e caso crítico vai para o N2.",
        },
      },
      { author: "system", text: "Conversa transferida para o N2.", ago: 35 * MINUTE },
    ],
  },
  {
    id: "conv-carla",
    employeeId: "emp-carla",
    state: "waiting_for_analyst",
    transfer: {
      level: "N1",
      reason: "agent_unsure",
      summary: "O Excel fecha sozinho ao abrir a planilha de campanhas com macros. A causa não está clara.",
      ago: 12 * MINUTE,
      priority: "medium",
    },
    messages: [
      { author: "employee", text: "Meu Excel fecha sozinho toda vez que abro a planilha de campanhas, a que tem macros.", ago: 14 * MINUTE },
      {
        author: "agent",
        text: "Não tenho segurança sobre a causa disso, então passei sua conversa para um analista do N1. Ele continua por aqui.",
        ago: 14 * MINUTE - 7 * SECOND,
        decision: {
          understanding: "Excel fecha ao abrir uma planilha com macros",
          action: "Transferir para o N1",
          toolsUsed: ["recordDecision", "searchArticles", "transferToAnalyst"],
          confidence: 0.41,
          reason: "Nenhum artigo cobre o caso e pode ser a planilha, as macros ou o Office.",
        },
      },
      { author: "system", text: "Conversa transferida para o N1.", ago: 12 * MINUTE },
    ],
  },
  {
    id: "conv-fabio",
    employeeId: "emp-fabio",
    state: "with_analyst",
    ticketId: "INC-20302",
    analystId: "analyst-rafael",
    transfer: {
      level: "N1",
      reason: "employee_request",
      summary: "VPN com erro 809 no Windows 11. Chamado INC-20302 aberto. O funcionário pediu para falar com um analista.",
      ago: 2 * HOUR,
      priority: "high",
    },
    messages: [
      { author: "employee", text: "A VPN dá erro 809 quando tento conectar de casa.", ago: 3 * HOUR },
      {
        author: "agent",
        text: "No Windows 11 esse erro precisa de um analista. Abri o chamado INC-20302 com prioridade alta.",
        ago: 3 * HOUR - 8 * SECOND,
        decision: {
          understanding: "Erro 809 na VPN no Windows 11",
          action: "Abrir chamado de VPN",
          toolsUsed: ["recordDecision", "searchArticles", "draftTicket"],
          confidence: 0.86,
          reason: "O artigo do erro 809 só resolve no Windows 10; no Windows 11 manda abrir chamado.",
        },
      },
      { author: "employee", text: "Prefiro falar com alguém, preciso disso hoje.", ago: 2 * HOUR + 2 * MINUTE },
      {
        author: "agent",
        text: "Passei sua conversa para um analista. Ele continua por aqui.",
        ago: 2 * HOUR,
        decision: {
          understanding: "Funcionário pediu um analista",
          action: "Transferir para o N1",
          toolsUsed: ["recordDecision", "transferToAnalyst"],
          confidence: 0.95,
          reason: "Pedido do funcionário vai para o N1.",
        },
      },
      { author: "system", text: "Conversa transferida para o N1.", ago: 2 * HOUR },
      { author: "system", text: "Rafael Lima assumiu a conversa.", ago: 1 * HOUR + 5 * MINUTE },
      { author: "analyst", text: "Oi, Fábio. Estou verificando o cliente de VPN da sua máquina.", ago: 1 * HOUR },
    ],
  },
  {
    id: "conv-bruno",
    employeeId: "emp-bruno",
    state: "with_agent",
    messages: [
      { author: "employee", text: "Como está meu pedido da licença do Power BI?", ago: 3 * MINUTE },
      {
        author: "agent",
        text: "Seu pedido REQ-10450 está aguardando um analista. O prazo dele é de 5 dias úteis desde a abertura, ontem.",
        ago: 3 * MINUTE - 8 * SECOND,
        decision: {
          understanding: "Quer saber a situação do pedido de licença do Power BI",
          action: "Consultar os chamados do funcionário",
          toolsUsed: ["recordDecision", "listMyTickets", "getTicket"],
          confidence: 0.9,
          reason: "Só existe um pedido de Power BI entre os chamados dele.",
        },
      },
    ],
  },
  {
    id: "conv-elisa",
    employeeId: "emp-elisa",
    state: "closed",
    outcome: "resolved_by_agent",
    closedAgo: 2 * HOUR,
    messages: [
      { author: "employee", text: "A VPN está dando erro 809. Uso Windows 10.", ago: 2 * HOUR + 10 * MINUTE },
      {
        author: "agent",
        text: "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador. No Windows 10 isso resolve o erro 809.",
        ago: 2 * HOUR + 10 * MINUTE - 7 * SECOND,
        decision: {
          understanding: "Erro 809 na VPN no Windows 10",
          action: "Responder com o artigo da central de ajuda",
          toolsUsed: ["recordDecision", "searchArticles"],
          confidence: 0.94,
          reason: "O artigo do erro 809 vale para o Windows 10.",
        },
      },
      { author: "employee", text: "Resolveu, obrigada!", ago: 2 * HOUR },
    ],
  },
  {
    id: "conv-gabriela",
    employeeId: "emp-gabriela",
    state: "closed",
    outcome: "closed_by_analyst",
    ticketId: "INC-20297",
    analystId: "analyst-marcos",
    transfer: {
      level: "N1",
      reason: "employee_request",
      summary: "Caixa de e-mail cheia mesmo depois de limpar os itens excluídos. Chamado INC-20297 aberto.",
      ago: 3 * DAY - 5 * MINUTE,
      priority: "high",
    },
    closedAgo: 2 * DAY,
    messages: [
      { author: "employee", text: "Minha caixa de e-mail está cheia e já limpei os itens excluídos.", ago: 3 * DAY },
      {
        author: "agent",
        text: "Abri o chamado INC-20297 e passei para um analista aumentar sua caixa.",
        ago: 3 * DAY - 9 * SECOND,
        decision: {
          understanding: "Caixa de e-mail cheia mesmo após limpeza",
          action: "Abrir chamado e transferir para o N1",
          toolsUsed: ["recordDecision", "searchArticles", "draftTicket", "transferToAnalyst"],
          confidence: 0.83,
          reason: "O artigo já foi seguido sem resolver.",
        },
      },
      { author: "system", text: "Marcos Oliveira assumiu a conversa.", ago: 2 * DAY + 2 * HOUR },
      { author: "analyst", text: "Aumentei sua caixa para 100 GB. Pode testar?", ago: 2 * DAY + 1 * HOUR },
      { author: "employee", text: "Funcionou, obrigada.", ago: 2 * DAY + 10 * MINUTE },
    ],
  },
];

// Closed conversations of the last weeks. With Elisa's and Gabriela's above, 13 of the 18 closed conversations
// were resolved by the agent (72%, the number on the login screen of the design). Ana has none.
const pastCases = [
  ["emp-carla", "Como faço para trocar a senha do Wi-Fi do escritório no meu notebook?", "Esqueça a rede Nexo-Corp nas configurações de Wi-Fi e conecte de novo com a senha nova da intranet.", "resolved_by_agent"],
  ["emp-bruno", "O Teams não mostra minha câmera.", "Feche o Teams, confira em Privacidade > Câmera se o Teams tem permissão e abra de novo.", "resolved_by_agent"],
  ["emp-diego", "Qual o horário do service desk?", "Segunda a sexta, das 8h às 18h. Casos críticos têm plantão 24 horas.", "resolved_by_agent"],
  ["emp-elisa", "Preciso pedir férias, onde faço isso?", "Férias são com o RH: rh@nexo.com.br ou ramal 4100.", "resolved_by_agent"],
  ["emp-fabio", "Não consigo abrir a pasta Jurídico no SharePoint.", "Abra a pasta, clique em Solicitar acesso e escreva o motivo. O dono da pasta aprova o pedido.", "resolved_by_agent"],
  ["emp-gabriela", "Minha caixa de e-mail diz que está cheia.", "Esvazie Itens Excluídos e use Arquivo > Ferramentas > Limpar itens antigos.", "resolved_by_agent"],
  ["emp-carla", "Como peço reembolso de um táxi?", "Reembolsos são com o financeiro: financeiro@nexo.com.br ou ramal 4200.", "resolved_by_agent"],
  ["emp-bruno", "A VPN deu erro 809, uso Windows 10.", "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador.", "resolved_by_agent"],
  ["emp-diego", "O ar-condicionado da sala 3 está pingando.", "Isso é com facilities: facilities@nexo.com.br ou ramal 4300.", "resolved_by_agent"],
  ["emp-elisa", "Como instalo o Power BI?", "Instale pelo portal de softwares, em Aplicativos aprovados > Power BI Desktop.", "resolved_by_agent"],
  ["emp-fabio", "O Outlook pede a senha toda hora.", "Remova as credenciais antigas do Outlook no Gerenciador de Credenciais e entre de novo.", "resolved_by_agent"],
  ["emp-gabriela", "Como imprimo em outro andar?", "Adicione a impressora pelo portal de impressão, escolhendo o andar e a sala.", "resolved_by_agent"],
  ["emp-carla", "Meu monitor externo não liga desde ontem.", "Abri um chamado para o N1 verificar o monitor. Um analista continua por aqui.", "closed_by_analyst"],
  ["emp-bruno", "O sistema de pedidos travou só para mim.", "Passei sua conversa para um analista do N1. Ele continua por aqui.", "closed_by_analyst"],
  ["emp-diego", "Preciso de acesso de administrador no notebook.", "Esse pedido precisa de aprovação, então passei para um analista do N1.", "closed_by_analyst"],
  ["emp-fabio", "Meu notebook não carrega a bateria.", "Abri um chamado de hardware e passei para um analista do N1.", "closed_by_analyst"],
] as const;

const pastConversations: SampleConversation[] = pastCases.map(([employeeId, question, answer, outcome], index) => {
  // Spread over the last 4 weeks; each first reply takes 8 s, like the average of the design.
  const openedAgo = (index + 2) * 36 * HOUR;
  const byAnalyst = outcome === "closed_by_analyst";
  return {
    id: `conv-past-${index + 1}`,
    employeeId,
    state: "closed",
    outcome,
    analystId: byAnalyst ? "analyst-juliana" : undefined,
    transfer: byAnalyst
      ? { level: "N1", reason: "employee_request", summary: question, ago: openedAgo - 10 * MINUTE, priority: "medium" }
      : undefined,
    closedAgo: openedAgo - (byAnalyst ? 2 * HOUR : 5 * MINUTE),
    messages: [
      { author: "employee", text: question, ago: openedAgo },
      {
        author: "agent",
        text: answer,
        ago: openedAgo - 8 * SECOND,
        decision: {
          understanding: question,
          action: byAnalyst ? "Transferir para o N1" : "Responder pela central de ajuda",
          toolsUsed: byAnalyst ? ["recordDecision", "transferToAnalyst"] : ["recordDecision", "searchArticles"],
          confidence: byAnalyst ? 0.7 : 0.93,
          reason: byAnalyst ? "Precisa de um analista para resolver." : "A central de ajuda cobre o caso.",
        },
      },
      byAnalyst
        ? { author: "analyst", text: "Resolvido por aqui. Qualquer coisa, é só chamar.", ago: openedAgo - 2 * HOUR + 5 * MINUTE }
        : { author: "employee", text: "Deu certo, obrigado!", ago: openedAgo - 6 * MINUTE },
    ],
  };
});

/** Recreates the sample conversations with dates relative to `now`. Keeps the Mastra memory tables untouched. */
export async function seed(db: Db, now: Date = new Date()) {
  const ago = (ms: number) => new Date(now.getTime() - ms);

  await db.transaction(async (tx) => {
    await tx.delete(decisions);
    await tx.delete(drafts);
    await tx.delete(messages);
    await tx.delete(conversations);
    await tx.delete(usageCounters);

    for (const conversation of [...sampleConversations, ...pastConversations]) {
      const first = conversation.messages[0];
      const firstReply = conversation.messages.find((message) => message.author !== "employee");
      if (!first || !firstReply) throw new Error(`${conversation.id} needs an opening message and a reply`);

      const { transfer } = conversation;
      const transferredAt = transfer ? ago(transfer.ago) : null;

      await tx.insert(conversations).values({
        id: conversation.id,
        employeeId: conversation.employeeId,
        state: conversation.state,
        outcome: conversation.outcome ?? null,
        targetLevel: transfer?.level ?? null,
        transferReason: transfer?.reason ?? null,
        transferSummary: transfer?.summary ?? null,
        analystId: conversation.analystId ?? null,
        ticketId: conversation.ticketId ?? null,
        messageCount: conversation.messages.filter((message) => message.author === "employee").length,
        waitUntil:
          transfer && transferredAt
            ? dueAt({ priority: transfer.priority, createdAt: transferredAt, lastItResponseAt: null })
            : null,
        createdAt: ago(first.ago),
        firstResponseAt: ago(firstReply.ago),
        closedAt: conversation.closedAgo === undefined ? null : ago(conversation.closedAgo),
      });

      for (const [index, message] of conversation.messages.entries()) {
        const messageId = `${conversation.id}-msg-${index + 1}`;
        await tx.insert(messages).values({
          id: messageId,
          conversationId: conversation.id,
          author: message.author,
          text: message.text,
          parts: null,
          createdAt: ago(message.ago),
        });
        if (message.decision) {
          await tx.insert(decisions).values({ id: `${messageId}-decision`, messageId, ...message.decision });
        }
      }
    }
  });
}
