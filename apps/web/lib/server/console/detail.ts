import type { Analyst, ConsoleDetail } from "@nexo/shared";
import { asc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { conversations, decisions, messages } from "@/db/schema";
import type { Deps } from "../deps";
import { draftsOf, toDraftView } from "../drafts";
import { jsonError, readAnalystSession, serviceUnavailable } from "../http";
import { toConsoleMessage } from "../messages";
import { conversationRows, toConsoleConversation } from "./rows";

export const conversationNotFound = () => jsonError(404, "conversation_not_found", "Conversa não encontrada.");

/**
 * The conversation with its whole history, as the console reads it: every message, the notes of the console and of the
 * drafts, the decision of each agent reply and who wrote each analyst message. One round trip, plus the names.
 */
export async function loadDetail(deps: Deps, conversationId: string, analystId: string, analysts: Map<string, Analyst>) {
  const [[row], history, draftRows] = await deps.db.batch([
    conversationRows(deps.db, analystId, eq(conversations.id, conversationId)),
    deps.db
      .select({ message: messages, decision: decisions })
      .from(messages)
      .leftJoin(decisions, eq(decisions.messageId, messages.id))
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt)),
    draftsOf(deps.db, conversationId),
  ]);
  if (!row) return { ok: false as const, response: conversationNotFound() };
  const employees = await deps.directory.employees([row.conversation.employeeId]);
  if (!employees) return { ok: false as const, response: serviceUnavailable() };

  const seenAt = row.conversation.employeeSeenAt?.getTime() ?? 0;
  const detail: ConsoleDetail = {
    conversation: {
      ...toConsoleConversation(row, { employee: employees.get(row.conversation.employeeId), analysts, now: deps.now() }),
      transferSummary: row.conversation.transferSummary,
    },
    messages: history.map(({ message, decision }) => toConsoleMessage(message, { decision, seenAt })),
    drafts: draftRows.map(toDraftView),
  };
  return { ok: true as const, detail };
}

/** GET /api/console/conversations/:id. */
export async function detailHandler(request: NextRequest, deps: Deps, conversationId: string) {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session.response;
  const analysts = await deps.directory.analysts();
  if (!analysts) return serviceUnavailable();
  const loaded = await loadDetail(deps, conversationId, session.session.id, analysts);
  if (!loaded.ok) return loaded.response;
  return NextResponse.json<ConsoleDetail>(loaded.detail, { headers: { "cache-control": "private, no-store" } });
}
