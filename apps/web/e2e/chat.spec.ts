import { expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "./env";

// Story Funcionário 1 with the simulated model: the real agent, tools, help center and stream, without the LLM.
// One conversation for the whole file, in order, as Ana would have it.
test.describe.configure({ mode: "serial" });

const composer = (page: Page) => page.getByLabel("Mensagem para o Nexo");
const replies = (page: Page) => page.getByRole("article", { name: "Nexo Assist" });
const counter = (page: Page) => page.locator("#chat-counter");

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
  // The reply is over when it stops being busy.
  await expect(replies(page).last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
}

test("an empty chat greets Ana and counts nothing yet", async ({ page }) => {
  await signInAsAna(page);
  await expect(page.getByRole("heading", { name: "Oi, Ana. O que está acontecendo?" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Assistente online" })).toBeVisible();
  await expect(counter(page)).toHaveText("0/30 mensagens nesta sessão");
  await expect(composer(page)).toBeFocused();
});

test("a question of the help center is answered with the article, with the action and the decision", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "Minha VPN dá erro 809, uso Windows 10");

  await expect(page.getByRole("article", { name: "Você" })).toHaveText("Minha VPN dá erro 809, uso Windows 10");
  const reply = replies(page).last();
  await expect(reply).toContainText("buscou na central de ajuda");
  await expect(reply).toContainText("Reinstale o cliente de VPN pelo portal de softwares");
  await expect(counter(page)).toHaveText("1/30 mensagens nesta sessão");

  const detail = reply.getByRole("button", { name: "Ver decisão" });
  await expect(detail).toHaveAttribute("aria-expanded", "false");
  await detail.click();
  await expect(detail).toHaveAttribute("aria-expanded", "true");
  const record = reply.getByRole("definition");
  await expect(record).toHaveText([/Dúvida de TI/, "Buscar na central de ajuda", "Alta · 82%", /central de ajuda/]);
});

test("a subject of HR goes to its channel", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "Como faço para pedir férias?");
  const reply = replies(page).last();
  await expect(reply).toContainText("indicou o canal certo");
  await expect(reply).toContainText("rh@nexo.com.br");
  await expect(counter(page)).toHaveText("2/30 mensagens nesta sessão");
});

test("the conversation and its decisions are still there after reloading the page", async ({ page }) => {
  await signInAsAna(page);
  await expect(page.getByRole("article", { name: "Você" })).toHaveCount(2);
  await expect(replies(page)).toHaveCount(2);
  await expect(replies(page).first()).toContainText("buscou na central de ajuda");
  await replies(page).first().getByRole("button", { name: "Ver decisão" }).click();
  await expect(replies(page).first().getByRole("definition").nth(2)).toHaveText("Alta · 82%");
  await expect(counter(page)).toHaveText("2/30 mensagens nesta sessão");
});

test("Shift+Enter breaks the line and Enter sends", async ({ page }) => {
  await signInAsAna(page);
  await composer(page).fill("Oi");
  await composer(page).press("Shift+Enter");
  await composer(page).pressSequentially("bom dia");
  await expect(composer(page)).toHaveValue("Oi\nbom dia");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("");
  await expect(replies(page).last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  await expect(counter(page)).toHaveText("3/30 mensagens nesta sessão");
});

test("when the help center is down, the line says so and the agent explains", async ({ page, request }) => {
  await signInAsAna(page);
  // Longer than the three tries of the ticket-service client (about 1.2 s), short enough to wait out.
  const outage = await request.post(`${e2eEnv.TICKET_SERVICE_URL}/admin/outage?seconds=3`, {
    headers: { "x-service-secret": e2eEnv.TICKET_SERVICE_SECRET, "x-admin-key": e2eEnv.ADMIN_KEY },
  });
  expect(outage.ok()).toBe(true);

  await ask(page, "A impressora do 3º andar não imprime");
  const reply = replies(page).last();
  await expect(reply).toContainText("não acessou a central de ajuda");
  await expect(reply).toContainText("A central de ajuda não respondeu agora");

  // The next files need the ticket-service back.
  await expect
    .poll(async () => (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/analysts`, {
      headers: { "x-service-secret": e2eEnv.TICKET_SERVICE_SECRET },
    })).status(), { timeout: 10_000 })
    .toBe(200);
});
