import { type Browser, expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "./env";

// Stories Funcionário 5, Analista 2 and Analista 3, with the simulated model and the whole stack running: Ana asks for
// an analyst about her overdue ticket; Rafael (N2) finds her in "Para você", assumes, and they talk; he hands her back to
// the agent, and later closes the service. Two browsers at once, as two people.
test.describe.configure({ mode: "serial" });

const composer = (page: Page) => page.getByLabel("Mensagem para o Nexo");
const replies = (page: Page) => page.getByRole("article", { name: "Nexo Assist" });
const idle = (page: Page) => expect(replies(page).last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });

async function signIn(page: Page, email: string, home: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail corporativo").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("qualquer-senha");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(home);
}

async function ask(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
  await idle(page);
}

async function people(browser: Browser) {
  const ana = await (await browser.newContext()).newPage();
  const rafael = await (await browser.newContext()).newPage();
  await signIn(ana, "ana.souza@nexo.com.br", "/");
  await signIn(rafael, "rafael.lima@nexo.com.br", "/console");
  return { ana, rafael };
}

const list = (page: Page) => page.getByRole("list", { name: "Conversas" });
const row = (page: Page, name: string) => list(page).getByRole("link", { name: new RegExp(name) });
const conversation = (page: Page) => page.getByRole("region", { name: /^Conversa com/ });

test.beforeAll(async ({ request }) => {
  // The file before this one may leave the ticket-service in an outage: wait for it to answer again.
  await expect
    .poll(
      async () =>
        (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/analysts`, { headers: { "x-service-secret": e2eEnv.TICKET_SERVICE_SECRET } })).status(),
      { timeout: 15_000 },
    )
    .toBe(200);
});

test("Ana asks for an analyst about her overdue ticket, and the chat says who comes and until when", async ({ browser }) => {
  const { ana } = await people(browser);
  await ask(ana, "INC-20311 · Notebook lento após atualização do Windows");
  await replies(ana).last().getByRole("button", { name: "Falar com um analista" }).click();
  await idle(ana);
  await expect(replies(ana).last()).toContainText("Encaminhei para o Suporte N2. Um analista vai falar com você");
  await expect(ana.getByRole("separator", { name: /Transferida para Suporte N2/ })).toBeVisible();
  // The time she was promised stays above her composer, and the pill says who she waits for.
  await expect(ana.getByText(/^Um analista vai falar com você/)).toBeVisible();
  await expect(ana.getByText("Suporte N2 · Pode escrever enquanto espera")).toBeVisible();
  await expect(ana.getByRole("banner").getByText("Aguardando analista")).toBeVisible();
  await expect(composer(ana)).toHaveCount(0);
  await expect(ana.getByLabel("Mensagem para o analista")).toBeVisible();
});

test("Rafael finds her in Para você, opens the history and her tickets, and assumes", async ({ browser }) => {
  const { ana, rafael } = await people(browser);
  await rafael.getByRole("button", { name: /^Para você/ }).click();
  const line = row(rafael, "Ana Souza");
  await expect(line).toContainText("Transferida · INC-20311");
  await line.click();

  const open = conversation(rafael);
  await expect(open.getByRole("heading", { name: "Ana Souza" })).toBeVisible();
  await expect(open).toContainText("Aguardando atendente");
  await expect(open).toContainText("Ana espera um atendente");
  await expect(open.getByRole("separator", { name: /Transferida para Suporte N2/ })).toBeVisible();
  // The composer stays locked until he assumes.
  await expect(open.getByPlaceholder("Assuma o atendimento para responder")).toBeDisabled();

  const panel = rafael.getByRole("complementary", { name: "Chamados de Ana" });
  // How many depends on the files before this one, which open tickets for her.
  await expect(panel).toContainText(/\d+ abertos? · \d+ encerrados?/);
  await expect(panel.getByRole("group", { name: "Desta conversa" })).toContainText("INC-20311");
  await expect(panel.getByRole("group", { name: "Desta conversa" })).toContainText("Transferido para um analista");

  await open.getByRole("button", { name: "Assumir atendimento" }).click();
  await expect(open.getByRole("separator", { name: /Rafael Lima assumiu · agent pausado/ })).toBeVisible();
  await expect(open.getByRole("button", { name: "Encerrar atendimento" })).toBeVisible();
  await expect(panel.getByRole("group", { name: "Desta conversa" })).toContainText("Assumido por Rafael Lima");
  // She leaves "Para você" for "Minhas".
  await expect(row(rafael, "Ana Souza")).toHaveCount(0);
  await rafael.getByRole("button", { name: /^Minhas/ }).click();
  await expect(row(rafael, "Ana Souza")).toContainText("Você está atendendo");

  // Ana sees it in her chat without reloading.
  await expect(ana.getByRole("separator", { name: /Rafael Lima entrou na conversa/ })).toBeVisible({ timeout: 10_000 });
  await expect(ana.getByRole("banner").getByText("Analista online")).toBeVisible();
});

test("they talk: his message reaches her chat, and hers reaches the console, without the agent", async ({ browser }) => {
  const { ana, rafael } = await people(browser);
  await rafael.getByRole("button", { name: /^Minhas/ }).click();
  await row(rafael, "Ana Souza").click();
  const open = conversation(rafael);
  const write = open.getByLabel("Mensagem para Ana");
  await write.fill("Oi, Ana! Aqui é o Rafael. Pode deixar o notebook ligado agora?");
  await write.press("Enter");
  await expect(open.getByRole("article", { name: "Rafael Lima" }).last()).toContainText("Pode deixar o notebook ligado agora?");

  const fromRafael = ana.getByRole("article", { name: "Rafael Lima" }).last();
  await expect(fromRafael).toContainText("Pode deixar o notebook ligado agora?", { timeout: 10_000 });
  await expect(fromRafael).toContainText("Suporte N2");

  await ana.getByLabel(/Mensagem para/).fill("Posso sim, está ligado.");
  await ana.getByLabel(/Mensagem para/).press("Enter");
  await expect(open.getByRole("article", { name: "Ana Souza" }).last()).toContainText("Posso sim, está ligado.", { timeout: 10_000 });
  // As nexo.pen draws them: a short message on one line, a long one wrapped in a bubble of 420 px.
  const short = open.getByRole("article", { name: "Ana Souza" }).last().locator("[data-wrapped]");
  await expect(short).toHaveAttribute("data-wrapped", "false");
  const long = open.getByRole("article", { name: "Rafael Lima" }).last().locator("[data-wrapped]");
  await long.evaluate((element) => {
    // Long enough to wrap at any width of the column.
    (element.querySelector("p") as HTMLElement).textContent = "Vou iniciar o acesso remoto agora; é só aceitar o pedido que vai aparecer na tela do seu notebook.";
  });
  await rafael.setViewportSize({ width: 1441, height: 900 });
  await expect(long).toHaveAttribute("data-wrapped", "true");
  expect((await long.boundingBox())?.width).toBe(420);
  // Nobody but Rafael answered.
  await expect(replies(ana).last()).not.toContainText("Posso sim");
});

test("Rafael hands her back to the agent, which answers her again", async ({ browser }) => {
  const { ana, rafael } = await people(browser);
  await rafael.getByRole("button", { name: /^Minhas/ }).click();
  await row(rafael, "Ana Souza").click();
  await conversation(rafael).getByRole("button", { name: "Devolver ao agent" }).click();
  await expect(conversation(rafael).getByRole("separator", { name: /Rafael Lima devolveu ao agent/ })).toBeVisible();
  await expect(ana.getByRole("separator", { name: /Rafael Lima devolveu a conversa ao Nexo/ })).toBeVisible({ timeout: 10_000 });
  await ask(ana, "Qual o horário do service desk?");
  await expect(replies(ana).last()).not.toBeEmpty();
  // The ticket was overdue when she asked for him: his answer restarted the deadline, and the agent says what he wrote.
  await ask(ana, "INC-20311 · Notebook lento após atualização do Windows");
  await expect(replies(ana).last()).toContainText("dentro do prazo");
  await expect(replies(ana).last()).toContainText("Pode deixar o notebook ligado agora?");
});

test("after assuming again he closes the service, and her chat says it ended", async ({ browser }) => {
  const { ana, rafael } = await people(browser);
  await ask(ana, "Quero falar com um analista.");
  await rafael.getByRole("button", { name: /^Todas/ }).click();
  await row(rafael, "Ana Souza").click();
  const open = conversation(rafael);
  await open.getByRole("button", { name: "Assumir atendimento" }).click();
  await open.getByRole("button", { name: "Encerrar atendimento" }).click();
  await expect(open.getByRole("separator", { name: /Rafael Lima encerrou o atendimento/ })).toBeVisible();
  await expect(row(rafael, "Ana Souza")).toContainText("Encerrada por você");
  await expect(ana.getByRole("separator", { name: /Rafael Lima encerrou o atendimento/ })).toBeVisible({ timeout: 10_000 });
});

test("an analyst marks himself unavailable and available again", async ({ browser }) => {
  const { rafael } = await people(browser);
  const availability = rafael.getByRole("switch", { name: "Disponível" });
  await expect(availability).toHaveAttribute("aria-checked", "true");
  await availability.click();
  await expect(availability).toHaveAttribute("aria-checked", "false");
  await expect(availability).toContainText("Indisponível");
  await rafael.reload();
  await expect(rafael.getByRole("switch", { name: "Disponível" })).toHaveAttribute("aria-checked", "false");
  await rafael.getByRole("switch", { name: "Disponível" }).click();
  await expect(rafael.getByRole("switch", { name: "Disponível" })).toHaveAttribute("aria-checked", "true");
});

test("an employee is kept out of the console", async ({ browser }) => {
  const { ana } = await people(browser);
  await ana.goto("/console");
  await ana.waitForURL("/");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the console opens the conversation over the list, and her tickets only when asked for", async ({ page }) => {
    await signIn(page, "juliana.costa@nexo.com.br", "/console");
    await list(page).getByRole("link").first().click();
    const open = conversation(page);
    await expect(open).toBeInViewport();
    await expect(page.getByRole("complementary", { name: /^Chamados de/ })).toHaveCount(0);
    await open.getByRole("button", { name: "Mais opções" }).click();
    await page.getByRole("menuitem", { name: /^Mostrar chamados de/ }).click();
    await expect(page.getByRole("complementary", { name: /^Chamados de/ })).toBeVisible();
    await page.getByRole("button", { name: /^Fechar chamados de/ }).click();
    await open.getByRole("button", { name: "Voltar para a lista" }).click();
    await expect(list(page)).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
  });
});
