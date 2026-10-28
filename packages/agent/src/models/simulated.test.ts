import type { KbArticle } from "@nexo/shared";
import { describe, expect, it } from "vitest";
import { createMemory, createNexoAgent, streamReply } from "../agent";
import type { HelpCenter } from "../tools";
import { simulatedModel } from "./simulated";

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

/** A help center that answers by the first word it recognizes in the question. */
const helpCenter = (state: "up" | "down" = "up"): HelpCenter => ({
  searchArticles: async (query) => {
    if (state === "down") return { ok: false, error: { code: "unavailable", message: "down" } };
    if (/vpn|809/i.test(query)) return { ok: true, data: [vpn] };
    if (/rh/i.test(query)) return { ok: true, data: [hr] };
    return { ok: true, data: [] };
  },
});

async function reply(text: string, center = helpCenter()) {
  const agent = createNexoAgent({ model: simulatedModel(), memory: createMemory({ url: ":memory:" }), helpCenter: center });
  return streamReply(agent, { conversationId: "conv-1", employeeId: "emp-ana", text }).finished;
}

describe("simulatedModel", () => {
  it("records the decision, searches the help center and answers with the article", async () => {
    const result = await reply("Minha VPN dá erro 809");
    if (!result.ok) throw result.error;
    expect(result.decision).toMatchObject({
      action: "Buscar na central de ajuda",
      toolsUsed: ["recordDecision", "searchArticles"],
    });
    expect(result.decision.confidence).toBeGreaterThan(0.6);
    expect(result.text).toContain(vpn.content);
  });

  it("says when the help center has nothing about the case", async () => {
    const result = await reply("Meu mouse está piscando em roxo");
    if (!result.ok) throw result.error;
    expect(result.text).toContain("Não encontrei nada sobre isso na central de ajuda");
  });

  it("redirects a subject of HR to its channel", async () => {
    const result = await reply("Como faço para pedir férias?");
    if (!result.ok) throw result.error;
    expect(result.decision).toMatchObject({ action: "Indicar o canal de RH", toolsUsed: ["recordDecision", "redirectOutOfScope"] });
    expect(result.text).toContain("rh@nexo.com.br");
  });

  it("explains when the help center did not answer", async () => {
    const result = await reply("Minha VPN dá erro 809", helpCenter("down"));
    if (!result.ok) throw result.error;
    expect(result.text).toContain("A central de ajuda não respondeu");
  });

  it("answers a greeting without searching", async () => {
    const result = await reply("Oi, bom dia!");
    if (!result.ok) throw result.error;
    expect(result.decision.toolsUsed).toEqual(["recordDecision"]);
    expect(result.text).toContain("Como posso ajudar");
  });
});
