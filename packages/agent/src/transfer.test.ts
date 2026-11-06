import { RequestContext } from "@mastra/core/request-context";
import { dueAt, type Ticket, type TicketDetail, type TicketServiceResult } from "@nexo/shared";
import { describe, expect, it, vi } from "vitest";
import { createTools, newReplyTurn, type TicketDesk, type TransferRecord, type TransferStore } from "./tools";

// The transfer to an analyst (feature 5): the model says why and writes the summary; the level and the wait come from
// the code, from the ticket of the employee, and the conversation only moves if it is still with the agent.

// Monday 10:05 in São Paulo.
const NOW = new Date("2026-10-26T13:05:00Z");
/** Her message, a few seconds before the transfer. */
const TURN_STARTED_AT = new Date(NOW.getTime() - 4_000);
const DAY = 24 * 60 * 60 * 1000;

function detail(fields: Partial<TicketDetail> & Pick<TicketDetail, "id" | "priority">, openedDaysAgo: number): TicketDetail {
  const createdAt = new Date(NOW.getTime() - openedDaysAgo * DAY);
  return {
    type: "INC",
    title: "Notebook lento após atualização do Windows",
    description: "Lentidão geral.",
    category: "hardware",
    subcategory: "Notebook",
    affected: "only_me",
    status: "waiting_for_analyst",
    openedBy: "emp-ana",
    assignedTo: null,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    lastItResponseAt: null,
    dueAt: dueAt({ priority: fields.priority, createdAt, lastItResponseAt: null, reopenedAt: null }).toISOString(),
    resolvedAt: null,
    assigneeName: null,
    updates: [],
    ...fields,
  };
}

/** INC-20311, medium, opened 6 days ago: past its 3 business days. */
const overdue = detail({ id: "INC-20311", priority: "medium" }, 6);
/** A high ticket opened an hour ago: within its 4 business hours. */
const recent = detail({ id: "INC-20330", priority: "high" }, 1 / 24);

const down = { ok: false, error: { code: "unavailable", message: "Ticket service is unavailable" } } as const;
const unexpected = async (): Promise<never> => {
  throw new Error("not used in this test");
};

function setup({ reads = "up", marks = "up", stillWithAgent = true } = {}) {
  const transfers: TransferRecord[] = [];
  const marked: Array<{ ticketId: string; body: unknown; key: string }> = [];
  const desk: TicketDesk = {
    searchArticles: unexpected,
    listEmployeeTickets: unexpected,
    listCandidates: unexpected,
    getTicket: async (id, employeeId): Promise<TicketServiceResult<TicketDetail | null>> => {
      if (reads === "down") return down;
      const found = [overdue, recent].find((one) => one.id === id);
      return { ok: true, data: found && employeeId === "emp-ana" ? found : null };
    },
    transferTicket: async (ticketId, body, key): Promise<TicketServiceResult<Ticket>> => {
      marked.push({ ticketId, body, key });
      return marks === "down" ? down : { ok: true, data: overdue };
    },
  };
  const store: TransferStore = {
    transfer: async (record) => {
      transfers.push(record);
      return stillWithAgent ? { transferred: true, noteId: `note-${record.conversationId}-transferred-1` } : { transferred: false };
    },
  };
  const { transferToAnalyst } = createTools({ ticketService: desk, drafts: { save: unexpected }, transfers: store, resolutions: { check: unexpected }, now: () => NOW });
  return { transferToAnalyst, transfers, marked };
}

const summary = "Notebook lento há 6 dias desde a atualização; o INC-20311 venceu e a Ana pediu um analista.";

/** The context of one reply, as the agent builds it: the confidence is what its decision recorded. */
function replyContext({ confidence = null as number | null, needsInformation = false, employeeId = "emp-ana" } = {}) {
  return new RequestContext<unknown>([
    ["employeeId", employeeId],
    ["conversationId", "conv-ana"],
    ["turn", { ...newReplyTurn(TURN_STARTED_AT), confidence, needsInformation }],
  ]);
}

function run(tool: ReturnType<typeof setup>["transferToAnalyst"], input: unknown, options: Parameters<typeof replyContext>[0] = {}) {
  return tool.execute!(input as never, { requestContext: replyContext(options) } as never);
}

describe("transferToAnalyst", () => {
  it("sends an overdue ticket to N2 and moves the conversation, with the summary and the wait", async () => {
    const { transferToAnalyst, transfers } = setup();
    const result = await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20311" });
    expect(result).toEqual({
      ok: true,
      level: "N2",
      levelLabel: "Suporte N2",
      transferReason: "overdue",
      ticketId: "INC-20311",
      // Medium: 3 business days from the transfer.
      waitUntil: "2026-10-29T13:05:00.000Z",
      waitText: "até 29 out, 10:05",
    });
    expect(transfers).toEqual([
      {
        conversationId: "conv-ana",
        level: "N2",
        reason: "overdue",
        summary,
        ticketId: "INC-20311",
        waitUntil: new Date("2026-10-29T13:05:00.000Z"),
        confidence: null,
        turnStartedAt: TURN_STARTED_AT,
        at: NOW,
      },
    ]);
  });

  it("notes the transfer on the ticket, with the note as the key, so a retry notes it once", async () => {
    const { transferToAnalyst, marked } = setup();
    await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20311" });
    expect(marked).toEqual([
      { ticketId: "INC-20311", body: { employeeId: "emp-ana", level: "N2", summary }, key: "note-conv-ana-transferred-1" },
    ]);
  });

  it("sends the employee's request about a ticket within its deadline to N1, waiting the deadline of its priority", async () => {
    const { transferToAnalyst } = setup();
    const result = await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20330" });
    expect(result).toMatchObject({ ok: true, level: "N1", transferReason: "employee_request", waitText: "hoje, até 14:05" });
  });

  it("transfers a case without a ticket as medium, unless the model classified it", async () => {
    const { transferToAnalyst, marked } = setup();
    expect(await run(transferToAnalyst, { reason: "employee_request", summary })).toMatchObject({ level: "N1", ticketId: null });
    const stopped = { reason: "employee_request", summary, impact: "stopped", urgency: "none", affected: "company" };
    expect(await run(transferToAnalyst, stopped)).toMatchObject({ level: "N2", transferReason: "critical", waitText: "hoje, até 11:05" });
    expect(marked).toEqual([]);
  });

  it("records the doubt of the agent when its decision came below 0.6, whatever the model said", async () => {
    const { transferToAnalyst, transfers } = setup();
    const result = await run(transferToAnalyst, { reason: "employee_request", summary }, { confidence: 0.41 });
    expect(result).toMatchObject({ ok: true, transferReason: "agent_unsure" });
    expect(transfers[0]).toMatchObject({ reason: "agent_unsure", confidence: 0.41 });
  });

  it("does not call it doubt when the decision was low for lack of information: she asked for the analyst", async () => {
    const { transferToAnalyst, transfers } = setup();
    const result = await run(transferToAnalyst, { reason: "employee_request", summary }, { confidence: 0.41, needsInformation: true });
    expect(result).toMatchObject({ ok: true, transferReason: "employee_request" });
    expect(transfers[0]).toMatchObject({ reason: "employee_request", confidence: 0.41 });
  });

  it("keeps how sure the decision was with a transfer she asked for, for the console", async () => {
    const { transferToAnalyst, transfers } = setup();
    await run(transferToAnalyst, { reason: "employee_request", summary }, { confidence: 0.9 });
    expect(transfers[0]).toMatchObject({ reason: "employee_request", confidence: 0.9 });
  });

  it("refuses a ticket that is not the employee's, without transferring", async () => {
    const { transferToAnalyst, transfers } = setup();
    const result = await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20319" });
    expect(result).toEqual({ ok: false, reason: "ticket_not_found", message: "Não encontrei o INC-20319 entre os chamados dele. Transfira sem o número." });
    expect(transfers).toEqual([]);
  });

  it("transfers anyway when the ticket-service is down: the employee still gets an analyst", async () => {
    const { transferToAnalyst, transfers, marked } = setup({ reads: "down" });
    const result = await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20311" });
    expect(result).toMatchObject({ ok: true, level: "N1", ticketId: null });
    expect(transfers[0]?.ticketId).toBeNull();
    expect(marked).toEqual([]);
  });

  it("keeps the transfer when the ticket could not be noted, and says so in the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { transferToAnalyst } = setup({ marks: "down" });
    const result = await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20311" });
    expect(result).toMatchObject({ ok: true, ticketId: "INC-20311" });
    expect(log).toHaveBeenCalledWith("transfer not noted on the ticket", { ticketId: "INC-20311", error: "unavailable" });
    log.mockRestore();
  });

  it("transfers once when the model asks twice in the same reply, and answers both the same", async () => {
    const { transferToAnalyst, transfers, marked } = setup();
    const context = replyContext();
    const input = { reason: "employee_request", summary, ticketId: "INC-20311" };
    const [first, second] = await Promise.all([
      transferToAnalyst.execute!(input as never, { requestContext: context } as never),
      transferToAnalyst.execute!(input as never, { requestContext: context } as never),
    ]);
    expect(first).toMatchObject({ ok: true, level: "N2" });
    expect(second).toEqual(first);
    expect(transfers).toHaveLength(1);
    expect(marked).toHaveLength(1);
  });

  it("lets the model fix a refused call in the same reply: only a transfer that happened is kept", async () => {
    const { transferToAnalyst, transfers } = setup();
    const context = replyContext();
    const call = (input: unknown) => transferToAnalyst.execute!(input as never, { requestContext: context } as never);
    expect(await call({ reason: "employee_request", summary, ticketId: "INC-20319" })).toMatchObject({ ok: false, reason: "ticket_not_found" });
    expect(await call({ reason: "employee_request", summary })).toMatchObject({ ok: true });
    expect(transfers).toHaveLength(1);
  });

  it("does nothing when an analyst took the conversation meanwhile", async () => {
    const { transferToAnalyst, marked } = setup({ stillWithAgent: false });
    const result = await run(transferToAnalyst, { reason: "employee_request", summary, ticketId: "INC-20311" });
    expect(result).toEqual({ ok: false, reason: "not_with_agent", message: "Um analista já está com esta conversa." });
    expect(marked).toEqual([]);
  });
});
