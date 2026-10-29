import { expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "./env";

// Story Funcionário 2 with the simulated model: Ana asks about a ticket without its number, picks it from the list,
// sees it is overdue and gets the offer of an analyst. The whole stack runs for real, only the LLM is out.
// It continues Ana's conversation, so nothing here depends on the counter.
test.describe.configure({ mode: "serial" });

const composer = (page: Page) => page.getByLabel("Mensagem para o Nexo");
const replies = (page: Page) => page.getByRole("article", { name: "Nexo Assist" });
const mine = (page: Page) => page.getByRole("article", { name: "Você" });
const idle = (page: Page) => expect(replies(page).last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });

async function signInAsAna(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail corporativo").fill("ana.souza@nexo.com.br");
  await page.getByLabel("Senha", { exact: true }).fill("qualquer-senha");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await idle(page);
}

// The file before this one ends with a forced outage of the ticket-service: wait for it to answer again.
test.beforeAll(async ({ request }) => {
  await expect
    .poll(
      async () =>
        (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/analysts`, {
          headers: { "x-service-secret": e2eEnv.TICKET_SERVICE_SECRET },
        })).status(),
      { timeout: 15_000 },
    )
    .toBe(200);
});

test("without the number, Ana gets her open tickets to choose from", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "Qual o status do meu chamado?");

  const reply = replies(page).last();
  await expect(reply).toContainText("consultou seus chamados");
  await expect(reply).toContainText("Você tem 3 chamados abertos. Sobre qual deles quer saber?");
  const rows = reply.getByRole("list", { name: "Seus chamados" }).getByRole("button");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText(/INC-20311.*Notebook lento após atualização do Windows.*Aguardando analista/);
  await expect(rows.nth(1)).toContainText(/INC-20298.*SharePoint.*Em andamento/);
  await expect(rows.nth(2)).toContainText(/REQ-10442.*Segundo monitor.*Aprovado/);
  // Nobody else's ticket, not even Diego's critical one.
  await expect(reply).not.toContainText("INC-20319");
});

test("choosing a ticket sends it and shows its card, overdue, with the offer of an analyst", async ({ page }) => {
  await signInAsAna(page);
  await replies(page).last().getByRole("button", { name: /INC-20311/ }).click();

  await expect(mine(page).last()).toHaveText("INC-20311 · Notebook lento após atualização do Windows");
  await idle(page);
  const reply = replies(page).last();
  await expect(reply).toContainText("consultou o INC-20311");
  await expect(reply).toContainText("calculou o prazo");

  const card = reply.getByRole("region", { name: "Chamado INC-20311" });
  await expect(card).toContainText("Notebook lento após atualização do Windows");
  await expect(card).toContainText("Hardware › Notebook");
  await expect(card).toContainText("Média");
  await expect(card).toContainText(/há 6 dias\s*· prazo vencido/);
  await expect(reply).toContainText(
    "Está sem atualização há 6 dias, acima do prazo de 3 dias úteis para prioridade média. Quer que eu chame um analista?",
  );
  await expect(reply.getByRole("group", { name: "Respostas rápidas" }).getByRole("button")).toHaveText([
    "Falar com um analista",
    "Adicionar informação",
    "Não, obrigado",
  ]);

  // The list above is history now: the choice is marked and it takes no more clicks.
  const list = replies(page).nth(-2).getByRole("list", { name: "Seus chamados" });
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(list.getByRole("listitem").first()).toContainText("sua escolha");
});

test("a quick reply is sent with the keyboard, and stays marked after a reload", async ({ page }) => {
  await signInAsAna(page);
  const decline = replies(page).last().getByRole("button", { name: "Não, obrigado" });
  await decline.focus();
  await page.keyboard.press("Enter");
  await expect(mine(page).last()).toHaveText("Não, obrigado");
  await idle(page);
  await expect(replies(page).last()).toContainText("Tudo bem. Se precisar de mais alguma coisa, é só escrever.");
  await expect(composer(page)).toBeFocused();

  await page.reload();
  const answered = replies(page).nth(-2).getByRole("group", { name: "Respostas rápidas" });
  await expect(answered.getByRole("button")).toHaveCount(0);
  await expect(answered).toContainText("Não, obrigado, sua escolha");
  await expect(replies(page).nth(-3).getByRole("list", { name: "Seus chamados" })).toContainText("sua escolha");
});

test("a ticket on time says so, with what IT wrote last", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "Como está o INC-20298?");
  const card = replies(page).last().getByRole("region", { name: "Chamado INC-20298" });
  await expect(card).toContainText("Em andamento");
  await expect(card).toContainText(/há 1 dia\s*· no prazo/);
  await expect(replies(page).last()).toContainText("Pedimos a liberação ao dono da pasta");
});

test("the number of somebody else's ticket finds nothing", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "E o INC-20319?");
  const reply = replies(page).last();
  await expect(reply).toContainText("não encontrou o INC-20319");
  await expect(reply).toContainText("Não encontrei o INC-20319 entre os seus chamados.");
  await expect(reply.getByRole("region")).toHaveCount(0);
  await expect(reply).not.toContainText("Sistema de pedidos");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the list and the card fit the width, the title whole", async ({ page }) => {
    await signInAsAna(page);
    const list = page.getByRole("list", { name: "Seus chamados" }).first();
    await list.scrollIntoViewIfNeeded();
    await expect(list).toContainText("Notebook lento após atualização do Windows");
    const card = page.getByRole("region", { name: "Chamado INC-20311" }).first();
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
  });
});
