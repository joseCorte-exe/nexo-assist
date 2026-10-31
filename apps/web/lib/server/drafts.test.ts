import type { DraftRecord } from "@nexo/agent";
import type { DraftView } from "@nexo/shared";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { conversations, drafts, messages } from "@/db/schema";
import { loadConversation } from "./conversation";
import { cancelDraftHandler, confirmDraftHandler, createDraftStore, editDraftHandler } from "./drafts";
import { ana, fakeTicketService, NOW, rafael, request, sessionCookieFor, testDeps, type TestDeps } from "./test-deps";

// The draft of a ticket, after the agent showed it: the employee edits, confirms or cancels it in the card, and the
// code does it, without the model (ARQUITETURA.md, sections 7 and 8).

const CONVERSATION = "conv-ana";
const HOUR = 60 * 60 * 1000;

const vpn: DraftRecord = {
  conversationId: CONVERSATION,
  operation: "create",
  ticketId: null,
  type: "INC",
  title: "VPN não conecta no notebook — erro 809",
  description: "Desde ontem o notebook (Windows 11) não conecta na VPN e mostra o erro 809. Precisa dela para a reunião das 14h.",
  category: "network_vpn",
  subcategory: "VPN",
  priority: "high",
  affected: "only_me",
  impact: "stopped",
  urgency: "same_day",
  notDuplicateReason: null,
  dueAt: new Date(NOW.getTime() + 4 * HOUR),
  createdAt: NOW,
};
const followUp: DraftRecord = {
  ...vpn,
  operation: "update",
  ticketId: "INC-20311",
  title: "Notebook lento após atualização do Windows",
  description: "Agora trava também ao abrir o Teams.",
  category: "hardware",
  subcategory: null,
  priority: "medium",
  impact: null,
  urgency: null,
};
const reopening = (ticketId: string): DraftRecord => ({
  ...followUp,
  operation: "reopen",
  ticketId,
  title: "Senha do SAP bloqueada",
  description: "A senha do SAP bloqueou de novo hoje cedo.",
  category: "access",
});

/** Ana's active conversation, with the agent, and a draft the agent showed in it. */
async function anaWithDraft(deps: TestDeps, record: DraftRecord = vpn) {
  await deps.db.insert(conversations).values({ id: CONVERSATION, employeeId: ana.id, state: "with_agent", createdAt: NOW });
  return createDraftStore(deps.db).save(record);
}

const anaCookie = () => sessionCookieFor({ role: "employee", ...ana });
const call = async (path: string, init: { method: string; body?: unknown; cookie?: string }) =>
  request(path, { ...init, cookie: init.cookie ?? (await anaCookie()) });

const confirm = async (deps: TestDeps, id: string, cookie?: string) =>
  confirmDraftHandler(await call(`/api/drafts/${id}/confirm`, { method: "POST", cookie }), deps, id);
const cancel = async (deps: TestDeps, id: string, cookie?: string) =>
  cancelDraftHandler(await call(`/api/drafts/${id}/cancel`, { method: "POST", cookie }), deps, id);
const edit = async (deps: TestDeps, id: string, body: unknown, cookie?: string) =>
  editDraftHandler(await call(`/api/drafts/${id}`, { method: "PATCH", body, cookie }), deps, id);

const systemMessages = (deps: TestDeps) =>
  deps.db
    .select({ id: messages.id, text: messages.text })
    .from(messages)
    .where(and(eq(messages.conversationId, CONVERSATION), eq(messages.author, "system")));

const statusOf = async (deps: TestDeps, id: string) =>
  (await deps.db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, id)))[0]?.status;

describe("createDraftStore", () => {
  it("saves the draft pending, numbered from D-381, and answers it as the card draws it", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    expect(draft).toEqual({
      id: expect.stringMatching(/^draft-[\w-]+$/),
      number: 381,
      operation: "create",
      status: "pending",
      ticketId: null,
      type: "INC",
      title: vpn.title,
      description: vpn.description,
      category: "network_vpn",
      subcategory: "VPN",
      priority: "high",
      affected: "only_me",
      rejectedReason: null,
      deadline: "4 horas úteis",
      dueAt: vpn.dueAt.toISOString(),
      createdAt: NOW.toISOString(),
    } satisfies DraftView);
  });

  it("numbers the drafts of every conversation in one sequence", async () => {
    const deps = await testDeps();
    await anaWithDraft(deps);
    // Bruno is talking to the agent in the sample data.
    const other = await createDraftStore(deps.db).save({ ...vpn, conversationId: "conv-bruno" });
    expect(other.number).toBe(382);
  });

  it("keeps one pending draft per conversation: a new one supersedes the one before", async () => {
    const deps = await testDeps();
    const first = await anaWithDraft(deps);
    const second = await createDraftStore(deps.db).save({ ...vpn, title: "VPN cai com erro 809" });
    expect(await statusOf(deps, first.id)).toBe("superseded");
    expect(await statusOf(deps, second.id)).toBe("pending");
  });
});

describe("POST /api/drafts/:id/confirm", () => {
  it("answers 401 without a session and 403 for an analyst", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    expect((await confirmDraftHandler(request(`/api/drafts/${draft.id}/confirm`, { method: "POST" }), deps, draft.id)).status).toBe(401);
    expect((await confirm(deps, draft.id, await sessionCookieFor({ role: "analyst", ...rafael }))).status).toBe(403);
  });

  it("answers the same 404 for a draft of somebody else and for one that does not exist, and creates nothing", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const diego = await sessionCookieFor({ role: "employee", id: "emp-diego", name: "Diego Ramos", email: "diego.ramos@nexo.com.br" });
    const theirs = await confirm(deps, draft.id, diego);
    const missing = await confirm(deps, "draft-nobody");
    const body = { error: { code: "draft_not_found", message: "Rascunho não encontrado." } };
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toEqual(body);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(body);
    expect(deps.ticketService.writes).toEqual([]);
  });

  it("creates the ticket with the draft, for the employee of the session, with the draft as the idempotency key", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const response = await confirm(deps, draft.id);
    expect(response.status).toBe(200);
    expect(deps.ticketService.writes).toEqual([
      {
        method: "POST",
        path: "/tickets",
        key: draft.id,
        body: {
          employeeId: ana.id,
          type: "INC",
          title: vpn.title,
          description: vpn.description,
          category: "network_vpn",
          subcategory: "VPN",
          priority: "high",
          affected: "only_me",
        },
      },
    ]);
  });

  it("answers the draft confirmed, with the number and the real deadline of the ticket", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    expect(await (await confirm(deps, draft.id)).json()).toEqual({
      ...draft,
      status: "confirmed",
      ticketId: "INC-20320",
      // High from Monday 10:00: 14:00 in São Paulo.
      dueAt: "2026-10-26T17:00:00.000Z",
    });
  });

  it("leaves a note in the conversation and in the agent memory, with the number and the deadline", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await confirm(deps, draft.id);
    const note = "Confirmei o rascunho D-381. O chamado INC-20320 foi criado, com prioridade alta e resposta hoje, até 14:00.";
    expect(await systemMessages(deps)).toEqual([{ id: `note-${draft.id}-confirmed`, text: note }]);
    expect(deps.notes).toEqual([`(ação na tela) ${note}`]);
  });

  it("answers a second confirmation with the same ticket, without writing again", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const first = await (await confirm(deps, draft.id)).json();
    const again = await confirm(deps, draft.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(deps.ticketService.writes).toHaveLength(1);
    expect(await systemMessages(deps)).toHaveLength(1);
  });

  it("adds a follow-up to the ticket, with only the new information", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps, followUp);
    const confirmed = (await (await confirm(deps, draft.id)).json()) as DraftView;
    expect(deps.ticketService.writes).toEqual([
      { method: "PATCH", path: "/tickets/INC-20311", key: draft.id, body: { employeeId: ana.id, text: followUp.description } },
    ]);
    expect(confirmed).toMatchObject({ status: "confirmed", ticketId: "INC-20311" });
    expect(deps.notes).toEqual(["(ação na tela) Confirmei o complemento do INC-20311. A informação nova foi acrescentada ao chamado."]);
  });

  it("reopens a ticket resolved 4 days ago, with what happened again", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps, reopening("INC-20150"));
    const confirmed = (await (await confirm(deps, draft.id)).json()) as DraftView;
    expect(deps.ticketService.writes[0]).toMatchObject({ method: "POST", path: "/tickets/INC-20150/reopen", key: draft.id });
    // Medium from Monday 10:00: Thursday 10:00.
    expect(confirmed).toMatchObject({ status: "confirmed", ticketId: "INC-20150", dueAt: "2026-10-29T13:00:00.000Z" });
    expect(deps.notes).toEqual([
      "(ação na tela) Confirmei a reabertura do INC-20150. Ele voltou para Aguardando analista, com resposta até 29 out, 10:00.",
    ]);
  });

  it("keeps the refusal of the service on the draft when the ticket can no longer be reopened", async () => {
    const deps = await testDeps();
    // INC-19877 was resolved 12 days ago.
    const draft = await anaWithDraft(deps, reopening("INC-19877"));
    const response = await confirm(deps, draft.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "rejected", rejectedReason: "reopen_window_closed" });
    expect(deps.notes).toEqual([
      "(ação na tela) Tentei confirmar a reabertura do INC-19877. O INC-19877 foi resolvido há mais de 7 dias e não pode mais ser reaberto.",
    ]);
    // Asked again, it does not try again.
    await confirm(deps, draft.id);
    expect(deps.ticketService.writes).toHaveLength(1);
  });

  it("keeps a confirmation the service did not answer as under way: only confirming again, which cannot duplicate", async () => {
    // The service may have written before falling: discarding or editing the draft now could hide a ticket that exists.
    const deps = await testDeps({ ticketService: fakeTicketService({ writesDown: true }) });
    const draft = await anaWithDraft(deps);
    const response = await confirm(deps, draft.id);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "service_unavailable", message: "O serviço de chamados não respondeu. Tente de novo em instantes." },
    });
    expect(await statusOf(deps, draft.id)).toBe("confirming");
    expect(await systemMessages(deps)).toEqual([]);
    expect(deps.notes).toEqual([]);

    const underWay = { error: { code: "draft_confirming", message: "A confirmação deste rascunho já começou. Confirme de novo; o chamado não será duplicado." } };
    const cancelled = await cancel(deps, draft.id);
    expect(cancelled.status).toBe(409);
    expect(await cancelled.json()).toEqual(underWay);
    expect((await edit(deps, draft.id, { title: "Outro" })).status).toBe(409);

    deps.ticketService.setWritesDown(false);
    expect(await (await confirm(deps, draft.id)).json()).toMatchObject({ status: "confirmed", ticketId: "INC-20320" });
  });

  it("never lets a cancel land while the ticket is being written", async () => {
    let meanwhile: Response | undefined;
    const deps = await testDeps({
      ticketService: fakeTicketService({
        onWrite: async () => {
          meanwhile = await cancel(deps, draft.id);
        },
      }),
    });
    const draft = await anaWithDraft(deps);
    const confirmed = await confirm(deps, draft.id);
    expect(meanwhile?.status).toBe(409);
    expect(await confirmed.json()).toMatchObject({ status: "confirmed", ticketId: "INC-20320" });
    expect(deps.notes).toEqual([expect.stringContaining("O chamado INC-20320 foi criado")]);
  });

  it("does not supersede a draft whose confirmation is under way when the agent drafts again", async () => {
    const deps = await testDeps({ ticketService: fakeTicketService({ writesDown: true }) });
    const draft = await anaWithDraft(deps);
    await confirm(deps, draft.id);
    await createDraftStore(deps.db).save(vpn);
    expect(await statusOf(deps, draft.id)).toBe("confirming");
  });

  it("refuses a draft that was cancelled or replaced", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await createDraftStore(deps.db).save(vpn);
    const response = await confirm(deps, draft.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "draft_not_pending", message: "Este rascunho não vale mais. Confira o mais recente." },
    });
    expect(deps.ticketService.writes).toEqual([]);
  });

  it("refuses a draft of a conversation that was closed", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await deps.db.update(conversations).set({ state: "closed", closedAt: NOW }).where(eq(conversations.id, CONVERSATION));
    const response = await confirm(deps, draft.id);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("conversation_closed");
  });
});

describe("PATCH /api/drafts/:id", () => {
  it("saves the title, the description and the category she edited, and drops a subcategory of the old category", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const response = await edit(deps, draft.id, { title: "  VPN cai com erro 809 ", description: "Erro 809 desde ontem.", category: "software" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...draft,
      title: "VPN cai com erro 809",
      description: "Erro 809 desde ontem.",
      category: "software",
      subcategory: null,
    });
    expect(deps.notes).toEqual([
      '(ação na tela) Editei o rascunho D-381: título "VPN cai com erro 809", descrição "Erro 809 desde ontem.", categoria Software.',
    ]);
  });

  it("refuses a category where she has a ticket that may be the same problem: that check is the agent's", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    // In access, INC-20298 is open and INC-20150 was resolved 4 days ago.
    const response = await edit(deps, draft.id, { category: "access" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "possible_duplicate",
        message: "Em Acesso você já tem o INC-20298 e o INC-20150, que podem ser o mesmo problema. Peça ao Nexo para conferir antes de mudar a categoria.",
      },
    });
    expect((await deps.db.select({ category: drafts.category }).from(drafts).where(eq(drafts.id, draft.id)))[0]?.category).toBe("network_vpn");
  });

  it("never changes the priority, which comes from the rule", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const edited = (await (await edit(deps, draft.id, { title: "VPN cai", priority: "critical" })).json()) as DraftView;
    expect(edited.priority).toBe("high");
  });

  it("only takes the text of a follow-up or a reopening, whose ticket keeps its title and category", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps, followUp);
    const refused = await edit(deps, draft.id, { title: "Outro título" });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({
      error: { code: "field_not_editable", message: "Num complemento ou reabertura, só o texto pode ser editado." },
    });
    expect((await edit(deps, draft.id, { description: "Trava no Teams e no Outlook." })).status).toBe(200);
  });

  it("says what is wrong with the fields", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const response = await edit(deps, draft.id, { title: " " });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_body", message: "Escreva o título." } });
  });

  it("leaves no note when nothing changed", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    expect((await edit(deps, draft.id, { title: vpn.title })).status).toBe(200);
    expect(deps.notes).toEqual([]);
  });

  it("refuses a draft that is no longer pending, and one of somebody else", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await confirm(deps, draft.id);
    expect((await edit(deps, draft.id, { title: "Depois" })).status).toBe(409);
    const bruno = await sessionCookieFor({ role: "employee", id: "emp-bruno", name: "Bruno Tavares", email: "bruno.tavares@nexo.com.br" });
    expect((await edit(deps, draft.id, { title: "Meu" }, bruno)).status).toBe(404);
  });
});

describe("POST /api/drafts/:id/cancel", () => {
  it("discards the draft and leaves a note", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    const response = await cancel(deps, draft.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...draft, status: "cancelled" });
    expect(await systemMessages(deps)).toEqual([{ id: `note-${draft.id}-cancelled`, text: "Descartei o rascunho D-381. Nada foi enviado." }]);
    expect(deps.notes).toEqual(["(ação na tela) Descartei o rascunho D-381. Nada foi enviado."]);
  });

  it("answers a second cancel with the same, noting it once", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await cancel(deps, draft.id);
    const again = await cancel(deps, draft.id);
    expect(again.status).toBe(200);
    expect(deps.notes).toHaveLength(1);
  });

  it("answers an action the draft can no longer take with the draft as it is, or with why not, for every state", async () => {
    const notValid = { code: "draft_not_pending", message: "Este rascunho não vale mais. Confira o mais recente." };
    const notEditable = { code: "draft_not_pending", message: "Este rascunho não pode mais ser editado." };
    const underWay = { code: "draft_confirming", message: "A confirmação deste rascunho já começou. Confirme de novo; o chamado não será duplicado." };
    const created = { code: "draft_confirmed", message: "Este chamado já foi criado." };
    const answers = {
      confirmed: { confirm: "view", cancel: created, edit: notEditable },
      rejected: { confirm: "view", cancel: "view", edit: notEditable },
      cancelled: { confirm: notValid, cancel: "view", edit: notEditable },
      superseded: { confirm: notValid, cancel: "view", edit: notEditable },
      confirming: { cancel: underWay, edit: underWay },
    } as const;
    for (const [status, byAction] of Object.entries(answers)) {
      for (const [action, expected] of Object.entries(byAction)) {
        const deps = await testDeps();
        const draft = await anaWithDraft(deps);
        await deps.db.update(drafts).set({ status: status as DraftView["status"] }).where(eq(drafts.id, draft.id));
        const response =
          action === "confirm" ? await confirm(deps, draft.id) : action === "cancel" ? await cancel(deps, draft.id) : await edit(deps, draft.id, { title: "Outro título" });
        const body = await response.json();
        if (expected === "view") expect([status, action, response.status, body.status]).toEqual([status, action, 200, status]);
        else expect([status, action, response.status, body.error]).toEqual([status, action, 409, expected]);
        expect(await statusOf(deps, draft.id)).toBe(status);
        expect(deps.ticketService.writes).toEqual([]);
      }
    }
  });

  it("refuses to cancel what was already created", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await confirm(deps, draft.id);
    const response = await cancel(deps, draft.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { code: "draft_confirmed", message: "Este chamado já foi criado." } });
  });
});

describe("loadConversation with drafts", () => {
  it("brings each draft of the conversation in its current state, for the cards", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await confirm(deps, draft.id);
    const loaded = await loadConversation(deps.db, ana.id);
    expect(loaded.drafts).toEqual([expect.objectContaining({ id: draft.id, status: "confirmed", ticketId: "INC-20320" })]);
  });

  it("leaves the notes out of the chat, which shows the card instead", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    await cancel(deps, draft.id);
    expect((await loadConversation(deps.db, ana.id)).messages).toEqual([]);
  });
});

describe("the cost of a draft in the database", () => {
  /** Counts the round trips to the database while the work runs: each query, batch or transaction is one. */
  async function roundTrips(deps: TestDeps, work: () => Promise<unknown>) {
    const client = deps.db.$client;
    let count = 0;
    const originals = { execute: client.execute, batch: client.batch, transaction: client.transaction };
    for (const name of ["execute", "batch", "transaction"] as const) {
      const original = originals[name] as (...args: unknown[]) => Promise<unknown>;
      (client as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        count++;
        return original.apply(client, args);
      };
    }
    try {
      await work();
    } finally {
      Object.assign(client, originals);
    }
    return count;
  }

  it("saves a draft, superseding the one before and numbering it, in one round trip", async () => {
    const deps = await testDeps();
    await anaWithDraft(deps);
    expect(await roundTrips(deps, () => createDraftStore(deps.db).save(vpn))).toBe(1);
  });

  it("confirms in three: read it, mark it confirming, and move it with its note", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    expect(await roundTrips(deps, () => confirm(deps, draft.id))).toBe(3);
  });

  it("cancels and edits in two", async () => {
    const deps = await testDeps();
    const draft = await anaWithDraft(deps);
    expect(await roundTrips(deps, () => edit(deps, draft.id, { title: "VPN cai" }))).toBe(2);
    expect(await roundTrips(deps, () => cancel(deps, draft.id))).toBe(2);
  });

  it("loads the conversation with its messages and drafts in two", async () => {
    const deps = await testDeps();
    await anaWithDraft(deps);
    expect(await roundTrips(deps, () => loadConversation(deps.db, ana.id))).toBe(2);
  });

  it("reads the drafts of a conversation and a draft of an employee through indexes, never scanning the table", async () => {
    const deps = await testDeps();
    const plan = async (query: ReturnType<typeof sql>) =>
      (await deps.db.all<{ detail: string }>(sql`explain query plan ${query}`)).map((step) => step.detail).join(" | ");
    expect(await plan(sql`select * from drafts where conversation_id = 'conv-ana' order by created_at`)).toContain(
      "USING INDEX drafts_conversation_created",
    );
    expect(
      await plan(sql`select * from drafts d join conversations c on c.id = d.conversation_id where d.id = 'x' and c.employee_id = 'emp-ana'`),
    ).toMatch(/SEARCH d USING INDEX sqlite_autoindex_drafts_1|SEARCH d USING PRIMARY KEY/);
  });
});
