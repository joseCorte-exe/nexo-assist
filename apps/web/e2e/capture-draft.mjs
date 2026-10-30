// Takes screenshots of the draft card (feature 4) in every state, as the employee sees them: waiting, editing, created,
// a follow-up, discarded, a reopening, the confirmation that failed with the service down, superseded, and a phone.
// Usage: node e2e/capture-draft.mjs <base-url> <tickets-url> <output-dir>
// Both databases freshly seeded, simulated model, TICKET_SERVICE_SECRET and ADMIN_KEY in the environment.
import { chromium } from "@playwright/test";

const [baseUrl = "http://localhost:3100", ticketsUrl = "http://localhost:3101", outDir = ".e2e/shots"] = process.argv.slice(2);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
});
const page = await context.newPage();
await page.goto(`${baseUrl}/login`);
await page.getByLabel("E-mail corporativo").fill("ana.souza@nexo.com.br");
await page.getByLabel("Senha", { exact: true }).fill("0123456789");
await page.getByRole("button", { name: "Entrar" }).click();
await page.waitForURL(`${baseUrl}/`);

const composer = () => page.getByLabel("Mensagem para o Nexo");
const lastReply = () => page.getByRole("article", { name: "Nexo Assist" }).last();
const lastDraft = () => lastReply().getByRole("region").last();
const idle = () => lastReply().and(page.locator("[aria-busy=false]")).waitFor({ timeout: 20_000 });

async function say(text) {
  await composer().fill(text);
  await composer().press("Enter");
  await page.waitForTimeout(300);
  await idle();
}

async function pick(option) {
  await lastReply().getByRole("button", { name: option }).click();
  await page.waitForTimeout(300);
  await idle();
}

/** The whole screen, or only an element with a margin around it. */
async function shot(name, element) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  if (!element) return page.screenshot({ path: `${outDir}/${name}.png` });
  await element.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await element.boundingBox();
  const margin = 16;
  await page.screenshot({
    path: `${outDir}/${name}.png`,
    clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin },
  });
}

// A new ticket: the question with its replies, then the draft.
await say("Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
await pick("Só eu");
await composer().blur();
await shot("rascunho-aguardando");
await lastDraft().getByRole("button", { name: "Editar" }).click();
await lastDraft().getByLabel("Título").fill("VPN não conecta no notebook — erro 809");
await shot("rascunho-editando", lastDraft());
await lastDraft().getByRole("button", { name: "Salvar" }).click();
await lastDraft().getByText("Aguardando confirmação").waitFor();
await lastDraft().getByRole("button", { name: "Confirmar" }).click();
await lastDraft().getByText(/criado\./).first().waitFor();
await shot("rascunho-criado", lastDraft());

// A follow-up of an open ticket, discarded.
await say("Como está o INC-20311?");
await pick("Adicionar informação");
await say("Agora trava também ao abrir o Teams.");
await composer().blur();
await shot("complemento-aguardando", lastDraft());
await lastDraft().getByRole("button", { name: "Cancelar" }).click();
await lastDraft().getByText("Rascunho descartado").first().waitFor();
await shot("complemento-descartado", lastDraft());

// A reopening, confirmed while the ticket-service is down, then again once it is back.
await say("A senha do SAP bloqueou de novo.");
await composer().blur();
await shot("reabertura-aguardando", lastDraft());
const headers = { "x-service-secret": process.env.TICKET_SERVICE_SECRET, "x-admin-key": process.env.ADMIN_KEY };
await fetch(`${ticketsUrl}/admin/outage?seconds=4`, { method: "POST", headers });
await lastDraft().getByRole("button", { name: "Confirmar" }).click();
await lastDraft().getByRole("alert").waitFor();
await shot("reabertura-servico-fora", lastDraft());
await page.waitForTimeout(4500);
await lastDraft().getByRole("button", { name: "Tentar de novo" }).click();
await lastDraft().getByText(/reaberto\./).first().waitFor();
await shot("reabertura-confirmada", lastDraft());

// Two drafts in a row: the first is superseded by the second.
await say("O teclado do notebook não funciona desde cedo.");
await pick("Só eu");
await say("O mouse também parou de funcionar desde cedo.");
await pick("Minha equipe");
await composer().blur();
const replies = page.getByRole("article", { name: "Nexo Assist" });
await shot("rascunho-substituido", replies.nth(-3).getByRole("region").last());
await shot("rascunho-novo-depois-do-substituido", lastDraft());

// A phone.
await page.setViewportSize({ width: 375, height: 812 });
await lastDraft().scrollIntoViewIfNeeded();
await page.waitForTimeout(500);
await shot("celular-rascunho");

await browser.close();
