import { expect, type Page, test } from "@playwright/test";
import { e2eEnv } from "./env";

// Stories Funcionário 3 and 4 with the simulated model: Ana opens a ticket only by talking, checks the draft, edits and
// confirms it; adds information to an open ticket; a problem that matches an open ticket becomes its follow-up; and a
// ticket resolved days ago is reopened. The whole stack runs for real, only the LLM is out. It runs after the file of
// feature 3 and continues Ana's conversation.
test.describe.configure({ mode: "serial" });

const composer = (page: Page) => page.getByLabel("Mensagem para o Nexo");
const replies = (page: Page) => page.getByRole("article", { name: "Nexo Assist" });
const idle = (page: Page) => expect(replies(page).last()).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
const serviceHeaders = { "x-service-secret": e2eEnv.TICKET_SERVICE_SECRET };

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

/** The card of the draft in the last reply. */
const lastDraft = (page: Page) => replies(page).last().getByRole("region").last();

test("Ana describes a problem and is asked who is affected, after the agent checked her tickets and the help center", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
  const reply = replies(page).last();
  await expect(reply).toContainText("consultou seus chamados");
  await expect(reply).toContainText("buscou na central de ajuda");
  await expect(reply).toContainText("Vou abrir um chamado.");
  await expect(reply.getByText("Quem está sendo afetado?")).toBeVisible();
  await expect(reply.getByRole("group", { name: "Respostas rápidas" }).getByRole("button")).toHaveText([
    "Só eu",
    "Minha equipe",
    "Toda a empresa",
    "Não sei",
  ]);
});

test("her answer gives the draft, with the priority of the rule, and nothing is created yet", async ({ page, request }) => {
  await signInAsAna(page);
  await replies(page).last().getByRole("button", { name: "Só eu" }).click();
  await idle(page);
  const reply = replies(page).last();
  await expect(reply).toContainText("classificou a prioridade");
  await expect(reply).toContainText("consultou o SLA");
  await expect(reply).toContainText("montou o rascunho");
  await expect(reply).toContainText("Confira antes de eu criar:");

  const draft = lastDraft(page);
  await expect(draft).toHaveAccessibleName("Novo chamado · Rascunho D-381");
  await expect(draft).toContainText("Aguardando confirmação");
  await expect(draft).toContainText("Notebook não conecta na VPN desde ontem");
  await expect(draft).toContainText("Rede e VPN");
  await expect(draft).toContainText(/Alta\s*· resposta até/);
  await expect(draft).toContainText("Somente você");

  const tickets = await (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/employees/emp-ana/tickets`, { headers: serviceHeaders })).json();
  expect(tickets.map((ticket: { id: string }) => ticket.id)).not.toContain("INC-20320");
});

test("she edits the title and the category in the card, never the priority", async ({ page }) => {
  await signInAsAna(page);
  const draft = lastDraft(page);
  await draft.getByRole("button", { name: "Editar" }).click();
  await expect(draft).toContainText("Editando");
  await expect(draft.getByLabel("Título")).toBeFocused();
  await draft.getByLabel("Título").fill("VPN não conecta no notebook — erro 809");
  await draft.getByLabel("Categoria").selectOption("software");
  await expect(draft.getByLabel("Prioridade")).toHaveCount(0);
  await draft.getByRole("button", { name: "Salvar" }).click();

  await expect(draft).toContainText("Aguardando confirmação");
  await expect(draft.getByRole("heading")).toHaveText("VPN não conecta no notebook — erro 809");
  await expect(draft).toContainText("Software");
  await expect(draft.getByRole("button", { name: "Confirmar" })).toBeFocused();
});

test("she confirms with the keyboard shortcut and the ticket is created, the same after a reload", async ({ page, request }) => {
  await signInAsAna(page);
  // The shortcut the button announces: Ctrl ↵ here, since the browser of the tests says it is Windows.
  const shortcut = await lastDraft(page).getByRole("button", { name: "Confirmar" }).getAttribute("aria-keyshortcuts");
  expect(shortcut).toBe("Control+Enter");
  await composer(page).focus();
  await page.keyboard.press(shortcut!);

  const draft = lastDraft(page);
  await expect(draft).toContainText("Chamado INC-20320 criado.");
  await expect(draft).toHaveAccessibleName("Chamado · INC-20320");
  await expect(draft.getByRole("button")).toHaveCount(0);
  await expect(composer(page)).toBeFocused();

  const ticket = await (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/tickets/INC-20320?employeeId=emp-ana`, { headers: serviceHeaders })).json();
  expect(ticket).toMatchObject({
    title: "VPN não conecta no notebook — erro 809",
    category: "software",
    priority: "high",
    affected: "only_me",
    status: "waiting_for_analyst",
  });

  await page.reload();
  await expect(lastDraft(page)).toContainText("Chamado INC-20320 criado.");
});

test("a problem about an open ticket becomes its follow-up, not a second ticket", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "Meu notebook continua muito lento desde a atualização.");
  await expect(replies(page).last()).toContainText("Você já tem o INC-20311 aberto sobre algo parecido.");
  await replies(page).last().getByRole("button", { name: "Só eu" }).click();
  await idle(page);

  const reply = replies(page).last();
  await expect(reply).toContainText("encontrou um chamado parecido");
  await expect(reply).toContainText("montou o complemento do INC-20311");
  const draft = lastDraft(page);
  await expect(draft).toHaveAccessibleName("Complemento · INC-20311");
  await expect(draft).toContainText("Informação nova");
  await expect(draft).toContainText("prazo vencido");
});

test("she discards it, and nothing is sent", async ({ page, request }) => {
  await signInAsAna(page);
  await lastDraft(page).getByRole("button", { name: "Cancelar" }).click();
  await expect(lastDraft(page)).toContainText("Rascunho descartado. Se mudar de ideia, é só pedir.");
  await expect(lastDraft(page)).toContainText("Descartado");
  const detail = await (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/tickets/INC-20311?employeeId=emp-ana`, { headers: serviceHeaders })).json();
  expect(detail.updates).toEqual([]);
});

test("Adicionar informação asks what to add and sends it to the ticket once she confirms", async ({ page, request }) => {
  await signInAsAna(page);
  await ask(page, "Como está o INC-20311?");
  await replies(page).last().getByRole("button", { name: "Adicionar informação" }).click();
  await idle(page);
  await expect(replies(page).last()).toContainText("O que você quer acrescentar ao INC-20311?");
  await ask(page, "Agora trava também ao abrir o Teams.");

  const draft = lastDraft(page);
  await expect(draft).toHaveAccessibleName("Complemento · INC-20311");
  await expect(draft).toContainText("Agora trava também ao abrir o Teams.");
  await draft.getByRole("button", { name: "Confirmar" }).click();
  await expect(draft).toContainText("Complemento enviado ao INC-20311.");

  const detail = await (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/tickets/INC-20311?employeeId=emp-ana`, { headers: serviceHeaders })).json();
  expect(detail.updates).toMatchObject([{ author: "employee", text: "Agora trava também ao abrir o Teams." }]);
  // The follow-up restarts nothing: the ticket is still overdue.
  expect(new Date(detail.dueAt).getTime()).toBeLessThan(Date.now());
});

test("a problem that came back reopens the ticket resolved 4 days ago", async ({ page, request }) => {
  await signInAsAna(page);
  await ask(page, "A senha do SAP bloqueou de novo.");
  const reply = replies(page).last();
  await expect(reply).toContainText("conferiu o prazo de 7 dias");
  const draft = lastDraft(page);
  await expect(draft).toHaveAccessibleName("Reabertura · INC-20150");
  await expect(draft).toContainText("O que aconteceu de novo");
  await draft.getByRole("button", { name: "Confirmar" }).click();
  await expect(draft).toContainText("INC-20150 reaberto.");

  const ticket = await (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/tickets/INC-20150?employeeId=emp-ana`, { headers: serviceHeaders })).json();
  expect(ticket).toMatchObject({ status: "waiting_for_analyst", resolvedAt: null });
});

test("past the 7 days she is told so, and a new ticket starts", async ({ page }) => {
  await signInAsAna(page);
  await ask(page, "O Outlook do celular parou de sincronizar de novo.");
  await expect(replies(page).last()).toContainText("O INC-19877 foi resolvido há mais de 7 dias e não pode ser reaberto.");
  await expect(replies(page).last().getByRole("button", { name: "Só eu" })).toBeVisible();
});

test("when the ticket service falls at the confirmation, the draft waits and the retry creates it once", async ({ page, request }) => {
  await signInAsAna(page);
  await replies(page).last().getByRole("button", { name: "Minha equipe" }).click();
  await idle(page);
  const draft = lastDraft(page);
  await expect(draft).toContainText("Aguardando confirmação");

  const outage = await request.post(`${e2eEnv.TICKET_SERVICE_URL}/admin/outage?seconds=4`, {
    headers: { ...serviceHeaders, "x-admin-key": e2eEnv.ADMIN_KEY },
  });
  expect(outage.ok()).toBe(true);
  await draft.getByRole("button", { name: "Confirmar" }).click();
  await expect(draft.getByRole("alert")).toContainText("O serviço de chamados não respondeu. Tente de novo; o chamado não será duplicado.");
  await expect(draft).toContainText("Aguardando confirmação");

  await page.waitForTimeout(4_500);
  await draft.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(draft).toContainText(/Chamado INC-\d{5} criado\./);
  const tickets = await (await request.get(`${e2eEnv.TICKET_SERVICE_URL}/employees/emp-ana/tickets`, { headers: serviceHeaders })).json();
  const outlook = tickets.filter((ticket: { title: string }) => /Outlook/.test(ticket.title) && ticket.title !== "Outlook não sincroniza no celular");
  expect(outlook).toHaveLength(1);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the draft card fits the width, its buttons on one line", async ({ page }) => {
    await signInAsAna(page);
    const draft = lastDraft(page);
    await draft.scrollIntoViewIfNeeded();
    await expect(draft).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBe(0);
  });
});
