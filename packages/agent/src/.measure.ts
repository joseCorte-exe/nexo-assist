// Temporary: runs the turns of feature 4 on the real model against the local ticket-service, and prints per turn the
// time, the tools, the draft and the tokens.
import { createTicketServiceClient, type DraftView, slaText } from "@nexo/shared";
import { AGENT_MODEL, createMemory, createNexoAgent, streamReply } from "./index";
import type { DraftStore } from "./tools";

const ticketService = createTicketServiceClient({ baseUrl: "http://localhost:3201", secret: process.env.TICKET_SERVICE_SECRET! });
let n = 0;
const drafts: DraftStore = {
  save: async ({ conversationId, impact, urgency, notDuplicateReason, ...draft }) => {
    n++;
    const view: DraftView = { ...draft, id: `draft-${n}`, number: 380 + n, status: "pending", rejectedReason: null, deadline: slaText(draft.priority), dueAt: draft.dueAt.toISOString(), createdAt: draft.createdAt.toISOString() };
    return view;
  },
};
const agent = createNexoAgent({ model: AGENT_MODEL, memory: createMemory({ url: ":memory:" }), ticketService, drafts });
const conversationId = `conv-measure-${Date.now()}-${Math.random()}`;

for (const text of process.argv.slice(2)) {
  const started = performance.now();
  const stream = await streamReply(agent, { conversationId, employeeId: "emp-ana", text });
  const full = await stream.getFullOutput();
  const calls = full.steps.flatMap((step) => step.toolCalls.map(({ payload }) => payload));
  const results = full.steps.flatMap((step) => step.toolResults.map(({ payload }) => payload));
  const draft = results.filter((r) => r.toolName === "draftTicket").map((r) => (r.result as { ok: boolean; draft?: DraftView; reason?: string }));
  const offer = calls.find((c) => c.toolName === "offerReplies")?.args as { question?: string; options?: string[] } | undefined;
  console.log(JSON.stringify({
    text,
    ms: Math.round(performance.now() - started),
    steps: full.steps.length,
    tools: calls.map((c) => c.toolName).filter((t) => t !== "updateWorkingMemory"),
    drafts: draft.map((d) => (d.ok ? `${d.draft!.operation}:${d.draft!.ticketId ?? ""}:${d.draft!.priority}:${d.draft!.category}:${d.draft!.type}` : `refused:${d.reason}`)),
    draftInput: calls.filter((c) => c.toolName === "draftTicket").map((c) => c.args).at(-1),
    offer: offer && `${offer.question} [${offer.options?.join(" / ")}]`,
    reply: full.text,
    usage: full.totalUsage,
    error: full.error ? String(full.error) : undefined,
  }));
}
