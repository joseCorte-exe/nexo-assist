import { expect, test } from "@playwright/test";
import { forgetSince, leaveCallWithNoEnd, setDayUsedUp } from "./db";

// The ceilings of the day, with the whole stack running: the day is used up, Gabriela's message stays with her and the
// chat says the demo is unavailable; the day given back, the Nexo answers.
const STARTED = new Date();

test.afterAll(async () => {
  await setDayUsedUp(false);
  await forgetSince(["emp-gabriela"], STARTED);
});

test("past the ceiling the chat says the demo is unavailable and keeps the message, and the Nexo answers once there is room", async ({ page }) => {
  await setDayUsedUp(true);
  await page.goto("/login");
  await page.getByLabel("E-mail corporativo").fill("gabriela.rocha@nexo.com.br");
  await page.getByLabel("Senha", { exact: true }).fill("qualquer-senha");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/");

  const composer = page.locator("#chat-message");
  const replies = page.getByRole("article", { name: "Nexo Assist" });
  const mine = page.getByRole("article", { name: "Você" });

  await composer.fill("Qual o horário do service desk?");
  await composer.press("Enter");

  const notice = replies.last().getByRole("alert");
  await expect(notice).toHaveText("O Nexo não pode responder: a demo está indisponível hoje. Sua mensagem ficou salva.");
  await expect(mine.last()).toHaveText("Qual o horário do service desk?");
  await expect(page.getByText("Não enviada.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);
  await expect(page.locator("#chat-counter")).toContainText("1/30");

  await page.reload();
  await expect(mine.last()).toHaveText("Qual o horário do service desk?");

  await setDayUsedUp(false);
  await composer.fill("Qual o horário do service desk?");
  await composer.press("Enter");
  await expect(replies.last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  await expect(replies.last()).toContainText("8h");
  await expect(replies.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("#chat-counter")).toContainText("2/30");

  // A message whose call never told how it ended is refused for today: no retry on offer, and she can write another.
  await page.route("**/api/chat", async (route) => {
    await leaveCallWithNoEnd((route.request().postDataJSON() as { id: string }).id);
    await route.continue();
  });
  await composer.fill("Ainda está aí?");
  await composer.press("Enter");
  await expect(replies.last().getByRole("alert")).toHaveText("Essa mensagem não pode ser reenviada agora. Envie outra.");
  await expect(mine.last()).toHaveText("Ainda está aí?");
  await expect(page.getByText("Não enviada.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tentar de novo" })).toHaveCount(0);

  await page.unroute("**/api/chat");
  await composer.fill("Qual o horário do service desk?");
  await composer.press("Enter");
  await expect(replies.last()).toContainText("8h", { timeout: 20_000 });
  await expect(replies.getByRole("alert")).toHaveCount(0);
});
