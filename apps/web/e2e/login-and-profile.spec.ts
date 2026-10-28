import { expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "./env";

const ANA = "ana.souza@nexo.com.br";
const RAFAEL = "rafael.lima@nexo.com.br";
const DAY_S = 24 * 60 * 60;

async function signIn(page: Page, email: string, { remember = false } = {}) {
  await page.goto("/login");
  await page.getByLabel("E-mail corporativo").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("qualquer-senha");
  const checkbox = page.getByLabel("Manter conectado neste computador");
  if ((await checkbox.isChecked()) !== remember) await checkbox.click();
  await page.getByRole("button", { name: "Entrar" }).click();
}

const sessionCookie = async (page: Page) => (await page.context().cookies()).find((cookie) => cookie.name === "nexo_session");

test.describe("login screen", () => {
  test("shows the three numbers from the database", async ({ page }) => {
    await page.goto("/login");
    const stats = page.getByRole("list", { name: "Números do service desk" });
    await expect(stats.getByRole("listitem").nth(0)).toHaveText(/8 s\s*primeira resposta, em média/);
    await expect(stats.getByRole("listitem").nth(1)).toHaveText(/72%\s*resolvidos sem fila/);
    await expect(stats.getByRole("listitem").nth(2)).toHaveText(/6\s*analistas online agora/);
  });

  test("asks for the e-mail and the password before sending", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Digite seu e-mail corporativo.")).toBeVisible();
    await expect(page.getByText("Digite sua senha.")).toBeVisible();
    await expect(page.getByLabel("E-mail corporativo")).toBeFocused();
  });

  test("says when the e-mail is not in the sample data", async ({ page }) => {
    await signIn(page, "ninguem@nexo.com.br");
    await expect(page.getByText("E-mail não encontrado.")).toBeVisible();
    await expect(page.getByLabel("E-mail corporativo")).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("shows and hides the password", async ({ page }) => {
    await page.goto("/login");
    const password = page.getByLabel("Senha", { exact: true });
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Esconder senha" }).click();
    await expect(password).toHaveAttribute("type", "password");
  });

  test("'Esqueci minha senha' needs the e-mail, then shows the notice", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Esqueci minha senha" }).click();
    await expect(page.getByText("Digite seu e-mail corporativo para receber o link.")).toBeVisible();

    await page.getByLabel("E-mail corporativo").fill(ANA);
    await page.getByRole("button", { name: "Esqueci minha senha" }).click();
    await expect(page.getByRole("status")).toHaveText(`Enviamos um link de redefinição para ${ANA}.`);
  });

  test("opens the privacy text and closes it with Escape", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Privacidade e uso de dados" }).click();
    const dialog = page.getByRole("dialog", { name: "Privacidade e uso de dados" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});

test.describe("employee", () => {
  test("signs in to the chat with a session that ends with the browser", async ({ page }) => {
    await signIn(page, ANA, { remember: false });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Atendimento" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect((await sessionCookie(page))?.expires).toBe(-1);
  });

  test("'Manter conectado' keeps the session for 30 days", async ({ page }) => {
    await signIn(page, ANA, { remember: true });
    await expect(page).toHaveURL(/\/$/);
    const expires = (await sessionCookie(page))?.expires ?? 0;
    expect(Math.abs(expires - (Date.now() / 1000 + 30 * DAY_S))).toBeLessThan(120);
    expect((await sessionCookie(page))?.httpOnly).toBe(true);
  });

  test("sees the profile and asks for a new password", async ({ page }) => {
    await signIn(page, ANA);
    await page.getByRole("link", { name: "Meu perfil" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "Meu perfil" })).toBeVisible();

    const data = page.getByRole("region", { name: "Dados de acesso" });
    await expect(data).toContainText("Ana Souza");
    await expect(data).toContainText(ANA);
    await expect(data).toContainText("Gerenciado pela TI");
    await expect(page.getByText("Alterada há 42 dias")).toBeVisible();
    await expect(page.getByText(`Enviaremos um link de redefinição para ${ANA}.`)).toBeVisible();

    await page.getByRole("button", { name: "Redefinir senha" }).click();
    await expect(page.getByRole("status")).toHaveText(`Enviamos um link de redefinição para ${ANA}.`);
  });

  test("signs out and cannot come back without signing in", async ({ page }) => {
    await signIn(page, ANA);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("cannot open the console", async ({ page }) => {
    await signIn(page, ANA);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/console");
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("analyst", () => {
  test("signs in to the console, stays out of the employee pages and signs out", async ({ page }) => {
    await signIn(page, RAFAEL);
    await expect(page).toHaveURL(/\/console$/);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/console$/);

    await page.getByRole("button", { name: "Rafael Lima" }).click();
    await page.getByRole("menuitem", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("ticket-service down", () => {
  test("the login explains it and the analysts number becomes a dash", async ({ page, request }) => {
    const outage = await request.post(`${e2eEnv.TICKET_SERVICE_URL}/admin/outage?seconds=8`, {
      headers: { "x-service-secret": e2eEnv.TICKET_SERVICE_SECRET, "x-admin-key": e2eEnv.ADMIN_KEY },
    });
    expect(outage.ok()).toBe(true);

    await page.goto("/login");
    const stats = page.getByRole("list", { name: "Números do service desk" });
    await expect(stats.getByRole("listitem").nth(2)).toHaveText(/–\s*analistas online agora/);
    await expect(stats.getByRole("listitem").nth(0)).toHaveText(/8 s/);

    await signIn(page, ANA);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("O serviço de chamados não respondeu. Tente de novo em instantes.");
    await expect(page).toHaveURL(/\/login$/);
  });
});
