// Takes 1440 x 900 screenshots of the chat, the same frame as nexo.pen, for the side-by-side check.
// Usage: node e2e/capture-chat.mjs <base-url> <output-dir> (the conversations DB freshly seeded, simulated model)
import { chromium } from "@playwright/test";

const [baseUrl = "http://localhost:3100", outDir = ".e2e/shots"] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "pt-BR" });
const page = await context.newPage();

async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}

const composer = () => page.getByLabel("Mensagem para o Nexo");
const lastReply = () => page.getByRole("article", { name: "Nexo Assist" }).last();

await page.goto(`${baseUrl}/login`);
await page.getByLabel("E-mail corporativo").fill("ana.souza@nexo.com.br");
await page.getByLabel("Senha", { exact: true }).fill("0123456789");
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${baseUrl}/`);
await composer().blur();
await shot("chat-empty");

await composer().fill("Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
await composer().press("Enter");
await page.getByText("entendendo o pedido").waitFor();
await shot("chat-thinking");
await lastReply().getByText("buscou na central de ajuda").waitFor();
await page.waitForTimeout(250);
await shot("chat-streaming");
await page.getByRole("button", { name: "Enviar" }).and(page.locator(":not([aria-disabled=true])")).waitFor();
await composer().blur();
await shot("chat-answered");

await lastReply().getByRole("button", { name: "Ver decisão" }).click();
await shot("chat-decision");

await composer().fill("Como faço para pedir férias?");
await composer().press("Enter");
await lastReply().getByText("indicou o canal certo").waitFor();
await page.getByRole("button", { name: "Enviar" }).and(page.locator(":not([aria-disabled=true])")).waitFor();
await composer().blur();
await shot("chat-out-of-scope");

await page.reload();
await composer().blur();
await shot("chat-reloaded");

await browser.close();
