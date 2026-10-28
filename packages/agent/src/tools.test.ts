import type { KbArticle } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createTools, type HelpCenter } from "./tools";

const vpn: KbArticle = {
  id: "kb-vpn-809",
  title: "VPN com erro 809",
  content: "Reinstale o cliente de VPN pelo portal de softwares e reinicie o computador.",
  category: "network_vpn",
};
const hr: KbArticle = {
  id: "kb-hr-channel",
  title: "Assuntos de RH",
  content: "Férias e holerite são tratados pelo RH: rh@nexo.com.br ou ramal 4100.",
  category: "other",
};

function helpCenter(articles: KbArticle[] | "down"): HelpCenter & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    searchArticles: async (query) => {
      queries.push(query);
      return articles === "down"
        ? { ok: false, error: { code: "unavailable", message: "Ticket service is unavailable" } }
        : { ok: true, data: articles };
    },
  };
}

// The tools run outside an agent here, so the context the runtime gives them is not needed.
const run = <I, O>(tool: { execute?: (input: I, context: never) => Promise<O> }, input: I) =>
  tool.execute!(input, {} as never);

describe("recordDecision", () => {
  it("only acknowledges: the route saves the decision at the end of the reply", async () => {
    const { recordDecision } = createTools({ helpCenter: helpCenter([]) });
    const result = await run(recordDecision, {
      understanding: "Dúvida sobre a VPN",
      action: "Buscar na central de ajuda",
      confidence: 0.8,
      reason: "Pode haver um artigo.",
    });
    expect(result).toEqual({ recorded: true });
  });
});

describe("searchArticles", () => {
  it("returns the articles of the help center for the question", async () => {
    const center = helpCenter([vpn]);
    const { searchArticles } = createTools({ helpCenter: center });
    expect(await run(searchArticles, { query: "vpn erro 809" })).toEqual({ ok: true, articles: [vpn] });
    expect(center.queries).toEqual(["vpn erro 809"]);
  });

  it("says the help center did not answer instead of failing, so the agent can explain", async () => {
    const { searchArticles } = createTools({ helpCenter: helpCenter("down") });
    expect(await run(searchArticles, { query: "vpn" })).toEqual({
      ok: false,
      message: "A central de ajuda não respondeu.",
    });
  });
});

describe("redirectOutOfScope", () => {
  it("finds the channel of the subject in the help center", async () => {
    const center = helpCenter([hr]);
    const { redirectOutOfScope } = createTools({ helpCenter: center });
    expect(await run(redirectOutOfScope, { area: "hr" })).toEqual({
      ok: true,
      area: "hr",
      channel: { title: hr.title, content: hr.content },
    });
    expect(center.queries).toEqual(["rh"]);
  });

  it("searches each area by the word the channel article uses", async () => {
    const center = helpCenter([]);
    const { redirectOutOfScope } = createTools({ helpCenter: center });
    await run(redirectOutOfScope, { area: "finance" });
    await run(redirectOutOfScope, { area: "facilities" });
    expect(center.queries).toEqual(["financeiro", "facilities"]);
  });

  it("only takes a channel article, never an IT article that happens to match", async () => {
    const { redirectOutOfScope } = createTools({ helpCenter: helpCenter([vpn]) });
    expect(await run(redirectOutOfScope, { area: "hr" })).toEqual({
      ok: false,
      area: "hr",
      message: "Não achei o canal na central de ajuda.",
    });
  });

  it("says the help center did not answer", async () => {
    const { redirectOutOfScope } = createTools({ helpCenter: helpCenter("down") });
    expect(await run(redirectOutOfScope, { area: "facilities" })).toEqual({
      ok: false,
      area: "facilities",
      message: "A central de ajuda não respondeu.",
    });
  });
});
