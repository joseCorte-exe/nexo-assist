import { createTool } from "@mastra/core/tools";
import { nexoToolSchemas, type OutOfScopeArea, type TicketServiceClient } from "@nexo/shared";

/** The part of the ticket-service the tools of this feature use. */
export type HelpCenter = Pick<TicketServiceClient, "searchArticles">;

const HELP_CENTER_DOWN = "A central de ajuda não respondeu.";

/** The channel article of each area in the help center (they live in the sample data), and the word that finds it. */
const AREA_CHANNEL: Record<OutOfScopeArea, { query: string; articleId: string }> = {
  hr: { query: "rh", articleId: "kb-hr-channel" },
  finance: { query: "financeiro", articleId: "kb-finance-channel" },
  facilities: { query: "facilities", articleId: "kb-facilities-channel" },
};

export function createTools({ helpCenter }: { helpCenter: HelpCenter }) {
  const recordDecision = createTool({
    id: "recordDecision",
    description:
      "Registra o que você entendeu, a ação que vai tomar, sua segurança (0 a 1) e o motivo. É sempre o primeiro passo da resposta.",
    ...nexoToolSchemas.recordDecision,
    // The route saves the decision when the reply ends, together with the tools that ran.
    execute: async () => ({ recorded: true as const }),
  });

  const searchArticles = createTool({
    id: "searchArticles",
    description: "Procura artigos na central de ajuda de TI da Nexo para responder a dúvida do funcionário.",
    ...nexoToolSchemas.searchArticles,
    execute: async ({ query }) => {
      const result = await helpCenter.searchArticles(query);
      return result.ok ? { ok: true as const, articles: result.data } : { ok: false as const, message: HELP_CENTER_DOWN };
    },
  });

  const redirectOutOfScope = createTool({
    id: "redirectOutOfScope",
    description:
      "Para assuntos que não são de TI (RH, financeiro, facilities): busca o canal certo para indicar ao funcionário.",
    ...nexoToolSchemas.redirectOutOfScope,
    execute: async ({ area }) => {
      const { query, articleId } = AREA_CHANNEL[area];
      const result = await helpCenter.searchArticles(query);
      if (!result.ok) return { ok: false as const, area, message: HELP_CENTER_DOWN };
      const channel = result.data.find((article) => article.id === articleId);
      return channel
        ? { ok: true as const, area, channel: { title: channel.title, content: channel.content } }
        : { ok: false as const, area, message: "Não achei o canal na central de ajuda." };
    },
  });

  return { recordDecision, searchArticles, redirectOutOfScope };
}
