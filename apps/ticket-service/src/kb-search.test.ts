import { describe, expect, it } from "vitest";
import { rankArticles, type SearchableArticle } from "./kb-search";

const article = (id: string, title: string, content: string, keywords: string[]): SearchableArticle => ({
  id,
  title,
  content,
  category: "other",
  keywords,
});

const vpn = article("kb-vpn-809", "VPN com erro 809", "Reinstale o cliente de VPN pelo portal de softwares.", [
  "vpn",
  "809",
  "erro 809",
  "windows 10",
]);
const hours = article("kb-hours", "Horário do service desk", "De segunda a sexta, das 8h às 18h.", [
  "horário",
  "atendimento",
  "service desk",
]);
const hr = article("kb-hr", "Assuntos de RH", "Férias e holerite são com o RH: rh@nexo.com.br.", ["rh", "férias", "holerite"]);
const sharepoint = article("kb-sharepoint", "Acesso a uma pasta do SharePoint", "Clique em Solicitar acesso.", [
  "sharepoint",
  "pasta",
]);
const all = [hours, hr, sharepoint, vpn];
const ids = (articles: SearchableArticle[]) => articles.map(({ id }) => id);

describe("rankArticles", () => {
  it("finds the article of the problem in the employee's own words", () => {
    expect(ids(rankArticles("Meu notebook não conecta na VPN, aparece o erro 809", all))[0]).toBe("kb-vpn-809");
  });

  it("ignores case and accents", () => {
    expect(ids(rankArticles("quero tirar FERIAS", all))).toEqual(["kb-hr"]);
    expect(ids(rankArticles("qual o horario do service desk?", all))[0]).toBe("kb-hours");
  });

  it("matches a keyword only as whole words", () => {
    // "rh" is inside "rhythm" and "garhoso", which must not reach the HR article.
    expect(ids(rankArticles("rhythm garhoso", all))).toEqual([]);
  });

  it("ranks a whole keyword above a word that only appears in the text", () => {
    const portal = article("kb-portal", "Portal de softwares", "Instale programas aprovados.", ["portal"]);
    // "portal" is a keyword of kb-portal and only a word in the text of kb-vpn-809.
    expect(ids(rankArticles("onde fica o portal?", [vpn, portal]))).toEqual(["kb-portal", "kb-vpn-809"]);
  });

  it("does not count words like 'o', 'de' and 'meu'", () => {
    expect(ids(rankArticles("o de meu da que", all))).toEqual([]);
  });

  it("returns nothing for an unrelated question", () => {
    expect(rankArticles("qual o sentido da vida?", all)).toEqual([]);
  });

  it("returns at most three articles, ties in id order", () => {
    const many = ["d", "a", "c", "b"].map((id) => article(`kb-${id}`, "Impressora", "Impressora.", ["impressora"]));
    expect(ids(rankArticles("impressora", many))).toEqual(["kb-a", "kb-b", "kb-c"]);
  });
});
