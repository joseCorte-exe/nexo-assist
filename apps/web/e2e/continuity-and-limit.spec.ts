import { type Browser, expect, type Page, test } from "@playwright/test";
import { dayAndMonth } from "@nexo/shared";
import { conversationWith, forgetSince } from "./db";
import { e2eEnv } from "./env";

// Story Funcionário 6 and the limit of 30 messages, with the simulated model and the whole stack running. Gabriela comes
// back to a conversation of three days ago, and later reaches the limit with nothing pending: it closes, and she starts
// over. Elisa reads how her last conversation ended, then reaches the limit with a question open: an analyst gets it,
// and Rafael can only close it.
test.describe.configure({ mode: "serial" });

const DAY = 24 * 60 * 60 * 1000;
const composer = (page: Page) => page.locator("#chat-message");
const replies = (page: Page) => page.getByRole("article", { name: "Nexo Assist" });
const counter = (page: Page) => page.locator("#chat-counter");
const idle = (page: Page) => expect(replies(page).last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });

async function signIn(page: Page, email: string, home = "/") {
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

const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

// Everything written for Gabriela and Elisa in this file goes away after it.
const STARTED = new Date();
test.afterAll(async () => {
  await forgetSince(["emp-gabriela", "emp-elisa"], STARTED);
});

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

test("Gabriela comes back three days later to the same conversation, each day opened by its pill", async ({ browser }) => {
  const lastAt = new Date(Date.now() - 3 * DAY);
  await conversationWith("emp-gabriela", { count: 2, lastAt, topic: "A impressora do 3º andar não imprime" });
  const page = await newPage(browser);
  await signIn(page, "gabriela.rocha@nexo.com.br");

  // Where she stopped, with the counter of the conversation.
  await expect(page.getByRole("article", { name: "Você" }).first()).toHaveText("A impressora do 3º andar não imprime");
  await expect(counter(page)).toHaveText("2/30 mensagens nesta sessão");
  // A conversation of a single day has no pill, as the chat of the design.
  await expect(page.getByText(dayAndMonth(lastAt), { exact: true })).toHaveCount(0);

  await ask(page, "Qual o horário do service desk?");
  // Now it spans two days: each opens with its pill, today's above what she wrote now.
  await expect(page.getByText(dayAndMonth(lastAt), { exact: true })).toBeVisible();
  await expect(page.getByText("Hoje", { exact: true })).toBeVisible();
  await expect(counter(page)).toHaveText("3/30 mensagens nesta sessão");
  await expect(replies(page).last()).toContainText("8h");
});

test("near the limit the counter says what is left; the 30th is answered and, with nothing pending, the conversation ends", async ({ browser }) => {
  await conversationWith("emp-gabriela", { count: 28, lastAt: new Date(Date.now() - 30 * 60 * 1000), topic: "Dúvidas sobre o notebook novo" });
  const page = await newPage(browser);
  await signIn(page, "gabriela.rocha@nexo.com.br");

  await expect(counter(page)).toHaveText("Restam 2 mensagens nesta sessão");
  await expect(counter(page)).toHaveClass(/text-warning-text/);
  await ask(page, "Qual o horário do service desk?");
  await expect(counter(page)).toHaveText("Resta 1 mensagem nesta sessão");
  await expect(page.getByRole("status").filter({ hasText: "Resta 1 mensagem nesta sessão" })).toBeAttached();

  await ask(page, "E qual o horário do service desk no plantão?");
  // The 30th is answered like any other, then the limit closes it: one note, the way to start over, and the composer for it.
  await expect(page.getByRole("separator", { name: /^Limite de 30 mensagens atingido · conversa encerrada · \d\d:\d\d$/ })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("separator", { name: /Limite de 30 mensagens/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Nova conversa" })).toBeVisible();
  await expect(composer(page)).toHaveAttribute("placeholder", "Comece uma nova conversa…");
  await expect(counter(page)).toHaveText("30/30 mensagens nesta sessão");

  // A reload shows how it ended, until she starts another.
  await page.reload();
  await expect(page.getByRole("separator", { name: /conversa encerrada/ })).toBeVisible();
  await page.getByRole("button", { name: "Nova conversa" }).click();
  await expect(page.getByRole("heading", { name: "Oi, Gabriela. O que está acontecendo?" })).toBeVisible();
  await expect(counter(page)).toHaveText("0/30 mensagens nesta sessão");
  await expect(composer(page)).toBeFocused();

  await ask(page, "Qual o horário do service desk?");
  await expect(page.getByRole("article", { name: "Você" })).toHaveCount(1);
  await expect(counter(page)).toHaveText("1/30 mensagens nesta sessão");
});

test("Elisa reads how her last conversation ended, and writing there starts a new one on a clean screen", async ({ browser }) => {
  const page = await newPage(browser);
  await signIn(page, "elisa.prado@nexo.com.br");
  await expect(page.getByText("Resolveu, obrigada!")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova conversa" })).toBeVisible();

  await ask(page, "Qual o horário do service desk?");
  await expect(page.getByText("Resolveu, obrigada!")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nova conversa" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Você" })).toHaveText("Qual o horário do service desk?");
});

test("with a question open at the limit an analyst gets it, and Rafael can only close it", async ({ browser }) => {
  await conversationWith("emp-elisa", { count: 29, lastAt: new Date(Date.now() - 20 * 60 * 1000), topic: "Dúvidas sobre o Teams" });
  const elisa = await newPage(browser);
  await signIn(elisa, "elisa.prado@nexo.com.br");
  await expect(counter(elisa)).toHaveText("Resta 1 mensagem nesta sessão");

  await ask(elisa, "Minha impressora não imprime");
  await expect(replies(elisa).last().getByRole("button", { name: "Só eu" })).toBeVisible();
  await expect(elisa.getByRole("separator", { name: /^Limite de 30 mensagens atingido · transferida para Suporte N1 · / })).toBeVisible({
    timeout: 10_000,
  });
  await expect(elisa.getByRole("banner").getByText("Aguardando analista")).toBeVisible();
  await expect(counter(elisa)).toHaveText("Limite do Nexo atingido · um analista continua com você");

  const rafael = await newPage(browser);
  await signIn(rafael, "rafael.lima@nexo.com.br", "/console");
  await rafael.getByRole("button", { name: /^Todas/ }).click();
  // Her newest conversation, first in Todas; the ones that ended before stay below it.
  const line = rafael.getByRole("list", { name: "Conversas" }).getByRole("link", { name: /Elisa Prado/ }).first();
  await expect(line).toContainText("Limite de mensagens · contato");
  await line.click();
  const conversation = rafael.getByRole("region", { name: /^Conversa com/ });
  await expect(conversation.getByRole("separator", { name: /Limite de 30 mensagens atingido · transferida para Suporte N1/ })).toBeVisible();
  // The note opens the summary of the case, which the code wrote at the limit.
  await conversation.getByRole("button", { name: "Ver o resumo do caso" }).click();
  await expect(conversation.getByText(/A conversa chegou ao limite de 30 mensagens com uma pergunta do Nexo sem resposta/)).toBeVisible();
  // It does not go back to the agent: no Devolver, before or after assuming.
  await expect(rafael.getByRole("button", { name: "Devolver ao agent" })).toHaveCount(0);
  await rafael.getByRole("button", { name: "Assumir atendimento" }).click();
  await expect(rafael.getByRole("button", { name: "Encerrar atendimento" })).toBeVisible();
  await expect(rafael.getByRole("button", { name: "Devolver ao agent" })).toHaveCount(0);

  await expect(elisa.getByRole("separator", { name: /Rafael Lima entrou na conversa/ })).toBeVisible({ timeout: 10_000 });
  await expect(counter(elisa)).toHaveText("Limite do Nexo atingido · Rafael Lima continua com você");
  await composer(elisa).fill("Só eu, obrigada");
  await composer(elisa).press("Enter");
  await expect(conversation.getByText("Só eu, obrigada").first()).toBeVisible({ timeout: 10_000 });

  await rafael.getByRole("button", { name: "Encerrar atendimento" }).click();
  await expect(elisa.getByRole("separator", { name: /Rafael Lima encerrou o atendimento/ })).toBeVisible({ timeout: 10_000 });
  await expect(elisa.getByRole("button", { name: "Nova conversa" })).toBeVisible();
});
