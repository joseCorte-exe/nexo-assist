import { createTool } from "@mastra/core/tools";
import {
  decisionRecord,
  type OutOfScopeArea,
  redirectOutOfScopeInput,
  redirectOutOfScopeOutput,
  searchArticlesInput,
  searchArticlesOutput,
  type TicketServiceClient,
} from "@nexo/shared";
import { z } from "zod";

/** The part of the ticket-service the tools of this feature use. */
export type HelpCenter = Pick<TicketServiceClient, "searchArticles">;

const HELP_CENTER_DOWN = "A central de ajuda não respondeu.";

/** The word each channel article of the help center is found by (they live in the sample data). */
const AREA_QUERY: Record<OutOfScopeArea, string> = { hr: "rh", finance: "financeiro", facilities: "facilities" };

export function createTools({ helpCenter }: { helpCenter: HelpCenter }) {
  const recordDecision = createTool({
    id: "recordDecision",
    description:
      "Registra o que você entendeu, a ação que vai tomar, sua segurança (0 a 1) e o motivo. É sempre o primeiro passo da resposta.",
    inputSchema: decisionRecord,
    outputSchema: z.object({ recorded: z.literal(true) }),
    // The route saves the decision when the reply ends, together with the tools that ran.
    execute: async () => ({ recorded: true as const }),
  });

  const searchArticles = createTool({
    id: "searchArticles",
    description: "Procura artigos na central de ajuda de TI da Nexo para responder a dúvida do funcionário.",
    inputSchema: searchArticlesInput,
    outputSchema: searchArticlesOutput,
    execute: async ({ query }) => {
      const result = await helpCenter.searchArticles(query);
      return result.ok ? { ok: true as const, articles: result.data } : { ok: false as const, message: HELP_CENTER_DOWN };
    },
  });

  const redirectOutOfScope = createTool({
    id: "redirectOutOfScope",
    description:
      "Para assuntos que não são de TI (RH, financeiro, facilities): busca o canal certo para indicar ao funcionário.",
    inputSchema: redirectOutOfScopeInput,
    outputSchema: redirectOutOfScopeOutput,
    execute: async ({ area }) => {
      const result = await helpCenter.searchArticles(AREA_QUERY[area]);
      if (!result.ok) return { ok: false as const, area, message: HELP_CENTER_DOWN };
      // Channel articles are the "other" ones; an IT article that happens to match is not a channel.
      const channel = result.data.find((article) => article.category === "other");
      return channel
        ? { ok: true as const, area, channel: { title: channel.title, content: channel.content } }
        : { ok: false as const, area, message: "Não achei o canal na central de ajuda." };
    },
  });

  return { recordDecision, searchArticles, redirectOutOfScope };
}
