// Takes 1440 x 900 screenshots of the screens, the same frame as nexo.pen, for the side-by-side check.
// Usage: node e2e/capture.mjs <base-url> <output-dir>
import { chromium } from "@playwright/test";

const [baseUrl = "http://localhost:3100", outDir = ".e2e/shots"] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: "pt-BR" });
const page = await context.newPage();

async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}

await page.goto(`${baseUrl}/login`);
// The design shows Ana's e-mail typed and the password field focused.
await page.getByLabel("E-mail corporativo").fill("ana.souza@nexo.com.br");
await page.getByLabel("Senha", { exact: true }).fill("0123456789");
await shot("login");

await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${baseUrl}/`);
await shot("home");
await page.goto(`${baseUrl}/profile`);
await shot("profile");
await page.getByRole("button", { name: "Redefinir senha" }).click();
await page.getByRole("status").waitFor();
await shot("profile-sent");

await page.getByRole("button", { name: "Sair" }).click();
await page.waitForURL(`${baseUrl}/login`);
await page.getByLabel("E-mail corporativo").fill("ninguem@nexo.com.br");
await page.getByLabel("Senha", { exact: true }).fill("x");
await page.getByRole("button", { name: "Entrar" }).click();
await page.getByText("E-mail não encontrado.").waitFor();
await shot("login-error");

await page.getByRole("button", { name: "Privacidade e uso de dados" }).click();
await page.waitForTimeout(300);
await shot("login-privacy");
await page.keyboard.press("Escape");

await page.getByLabel("E-mail corporativo").fill("rafael.lima@nexo.com.br");
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${baseUrl}/console`);
await page.getByRole("button", { name: "Rafael Lima" }).click();
await shot("console-menu");

await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("menuitem", { name: "Sair" }).click();
await page.waitForURL(`${baseUrl}/login`);
await shot("login-mobile");

await browser.close();
