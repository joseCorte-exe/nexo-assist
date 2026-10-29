// Takes 1440 x 900 screenshots of the ticket lookup (feature 3), the frame of "Chat — Consulta e transferência"
// in nexo.pen, plus the states the design does not draw and a phone width.
// Usage: node e2e/capture-ticket.mjs <base-url> <output-dir> (both databases freshly seeded, simulated model)
import { chromium } from "@playwright/test";

const [baseUrl = "http://localhost:3100", outDir = ".e2e/shots"] = process.argv.slice(2);
const browser = await chromium.launch();

async function session(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("E-mail corporativo").fill("ana.souza@nexo.com.br");
  await page.getByLabel("Senha", { exact: true }).fill("0123456789");
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(`${baseUrl}/`);
  return page;
}

const page = await session({ width: 1440, height: 900 });
const composer = () => page.getByLabel("Mensagem para o Nexo");
const lastReply = () => page.getByRole("article", { name: "Nexo Assist" }).last();
const idle = () => page.getByRole("button", { name: "Enviar" }).and(page.locator(":not([aria-disabled=true])")).waitFor();

async function shot(target, name) {
  await target.evaluate(() => document.fonts.ready);
  await target.mouse.move(0, 0);
  await target.waitForTimeout(350);
  await target.screenshot({ path: `${outDir}/${name}.png` });
}

await composer().fill("Qual o status do meu chamado?");
await composer().press("Enter");
await page.getByText("consultando seus chamados").waitFor();
await shot(page, "ticket-looking-up");
await lastReply().getByRole("list", { name: "Seus chamados" }).waitFor();
await idle();
await composer().blur();
await shot(page, "ticket-list");

const notebook = lastReply().getByRole("button", { name: /INC-20311/ });
await notebook.hover();
await page.waitForTimeout(250);
await page.screenshot({ path: `${outDir}/ticket-list-hover.png` });

await notebook.click();
await lastReply().getByText("calculou o prazo").waitFor();
await idle();
await composer().blur();
// The design frame: both replies, scrolled to the end.
await shot(page, "ticket-card");

await lastReply().getByRole("button", { name: "Falar com um analista" }).hover();
await page.waitForTimeout(250);
await page.screenshot({ path: `${outDir}/ticket-replies-hover.png` });

await lastReply().getByRole("button", { name: "Não, obrigado" }).click();
await idle();
await composer().blur();
await shot(page, "ticket-answered");

await page.reload();
await composer().blur();
await shot(page, "ticket-reloaded");

await composer().fill("Como está o INC-20298?");
await composer().press("Enter");
await lastReply().getByText("calculou o prazo").waitFor();
await idle();
await composer().blur();
await shot(page, "ticket-on-time");

await composer().fill("E o INC-20319?");
await composer().press("Enter");
await lastReply().getByText("não encontrou o INC-20319").waitFor();
await idle();
await composer().blur();
await shot(page, "ticket-not-found");

// The same conversation at a phone width.
const phone = await session({ width: 375, height: 812 });
await phone.getByLabel("Mensagem para o Nexo").blur();
await phone.getByRole("article", { name: "Nexo Assist" }).first().scrollIntoViewIfNeeded();
await shot(phone, "ticket-phone-list");
await phone.getByRole("region", { name: "Chamado INC-20311" }).first().scrollIntoViewIfNeeded();
await shot(phone, "ticket-phone-card");

await browser.close();
