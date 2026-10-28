import type { LoginStats } from "@nexo/shared";
import { sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { conversations } from "@/db/schema";
import type { Deps } from "./deps";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The three numbers of the login screen (ARQUITETURA.md, section 6), over the last 30 days.
 * The conversation numbers come from one aggregate query and the analysts from the ticket-service, in parallel.
 * Each number is independent: if the ticket-service is down, only the analysts become null.
 */
export async function getLoginStats(deps: Pick<Deps, "db" | "ticketService" | "now">): Promise<LoginStats> {
  const since = deps.now().getTime() - WINDOW_MS;
  const { createdAt, firstResponseAt, closedAt, outcome } = conversations;
  const createdInWindow = sql`${createdAt} >= ${since}`;
  const closedInWindow = sql`${closedAt} >= ${since}`;
  const responseTime = sql`${firstResponseAt} - ${createdAt}`;

  const [[row], analysts] = await Promise.all([
    deps.db
      .select({
        // avg and count skip the nulls the case expressions leave out.
        firstResponseMs: sql<number | null>`avg(case when ${createdInWindow} then ${responseTime} end)`,
        closed: sql<number>`count(case when ${closedInWindow} then 1 end)`,
        resolvedByAgent: sql<number>`count(case when ${closedInWindow} and ${outcome} = 'resolved_by_agent' then 1 end)`,
      })
      .from(conversations)
      .where(sql`${createdInWindow} or ${closedInWindow}`),
    deps.ticketService.listAnalysts(),
  ]);

  const firstResponseMs = row?.firstResponseMs ?? null;
  const closed = row?.closed ?? 0;
  return {
    firstResponseSeconds: firstResponseMs === null ? null : Math.round(firstResponseMs / 1000),
    resolvedWithoutQueuePercent: closed === 0 ? null : Math.round((100 * (row?.resolvedByAgent ?? 0)) / closed),
    analystsOnline: analysts.ok ? analysts.data.filter((analyst) => analyst.available).length : null,
  };
}

/** GET /api/stats/login. Public: the login screen shows it before anyone signs in. */
export async function loginStatsHandler(_request: NextRequest, deps: Deps) {
  return NextResponse.json<LoginStats>(await getLoginStats(deps), {
    headers: { "cache-control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" },
  });
}
