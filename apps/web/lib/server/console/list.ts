import { type AnalystLevel, type ConsoleFilter, type ConsoleListQuery, type ConsoleListResponse, consoleListQuery } from "@nexo/shared";
import { and, desc, eq, inArray, ne, or, type SQL, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { conversations } from "@/db/schema";
import type { Deps } from "../deps";
import { jsonError, readAnalystSession, serviceUnavailable } from "../http";
import { conversationRows, toConsoleConversation } from "./rows";

/** A page of the list: more than the screen shows, and what the console polls every 3 s. */
export const PAGE_SIZE = 50;

/** The text of a search as LIKE reads it: % and _ are letters, not wildcards. */
const likeContaining = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * GET /api/console/conversations?filter=&search=. Para você: what waits at the level of who is signed in. Com o agent:
 * what the agent attends. Minhas: what this analyst attends. Todas: everything, the most recent activity first. The
 * search finds the person by name, or the ticket by its number.
 */
export async function listHandler(request: NextRequest, deps: Deps) {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session.response;
  const query = consoleListQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return jsonError(400, "invalid_query", "Filtro ou busca inválidos.");
  const list = await loadList(deps, session.session.id, query.data);
  if (!list) return serviceUnavailable();
  return NextResponse.json<ConsoleListResponse>(list, { headers: { "cache-control": "private, no-store" } });
}

/**
 * The list as this analyst sees it, or null when the ticket-service, which owns the names, did not answer. The console
 * page reads it here on the server, so it opens with the list instead of a spinner.
 */
export async function loadList(deps: Deps, analystId: string, query: ConsoleListQuery): Promise<ConsoleListResponse | null> {
  const analysts = await deps.directory.analysts();
  const me = analysts?.get(analystId);
  if (!analysts || !me) return null;

  const { filter, search } = query;
  const matching = search ? await searchCondition(deps, search) : undefined;
  if (matching === null) return null;

  // The numbers of the chips and the page, in one round trip.
  const [[counts], rows] = await deps.db.batch([
    deps.db
      .select({
        forYou: sql<number>`coalesce(sum(${conversations.state} = 'waiting_for_analyst' and ${conversations.targetLevel} = ${me.level}), 0)`,
        withAgent: sql<number>`coalesce(sum(${conversations.state} = 'with_agent'), 0)`,
        mine: sql<number>`coalesce(sum(${conversations.state} = 'with_analyst' and ${conversations.analystId} = ${analystId}), 0)`,
        waiting: sql<number>`coalesce(sum(${conversations.state} = 'waiting_for_analyst'), 0)`,
      })
      .from(conversations)
      .where(ne(conversations.state, "closed")),
    conversationRows(deps.db, analystId, and(filterCondition(filter, { analystId, level: me.level }), matching))
      .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
      .limit(PAGE_SIZE),
  ]);

  const employees = await deps.directory.employees(rows.map((row) => row.conversation.employeeId));
  if (!employees) return null;
  const now = deps.now();
  return {
    conversations: rows.map((row) => toConsoleConversation(row, { employee: employees.get(row.conversation.employeeId), analysts, now })),
    counts: { forYou: Number(counts?.forYou ?? 0), withAgent: Number(counts?.withAgent ?? 0), mine: Number(counts?.mine ?? 0) },
    waiting: Number(counts?.waiting ?? 0),
  };
}

function filterCondition(filter: ConsoleFilter, { analystId, level }: { analystId: string; level: AnalystLevel }): SQL | undefined {
  switch (filter) {
    case "for_you":
      return and(eq(conversations.state, "waiting_for_analyst"), eq(conversations.targetLevel, level));
    case "with_agent":
      return eq(conversations.state, "with_agent");
    case "mine":
      return and(eq(conversations.state, "with_analyst"), eq(conversations.analystId, analystId));
    case "all":
      return undefined;
  }
}

/**
 * The conversations of the people whose name has the text, or about a ticket whose number has it. Null when the
 * ticket-service, which owns the names, did not answer.
 */
async function searchCondition(deps: Deps, search: string): Promise<SQL | null> {
  const found = await deps.ticketService.searchEmployees(search);
  if (!found.ok) return null;
  const byName = found.data.length > 0 ? inArray(conversations.employeeId, found.data.map((employee) => employee.id)) : undefined;
  const byTicket = /\d/.test(search)
    ? sql`${conversations.ticketId} like ${likeContaining(search.toUpperCase())} escape '\\'`
    : undefined;
  return or(byName, byTicket) ?? sql`0`;
}
