import { consoleFilter } from "@nexo/shared";
import type { Metadata } from "next";
import { connection } from "next/server";
import { loadDetail } from "@/lib/server/console/detail";
import { loadList } from "@/lib/server/console/list";
import { requireSession } from "@/lib/server/current-session";
import { getDeps } from "@/lib/server/deps";
import { ConsoleApp } from "./console-app";

export const metadata: Metadata = { title: "Console" };

/**
 * The console opens with what it shows already read on the server: the list of the filter in the address and the open
 * conversation, so there is no spinner on the first paint. From there the screen polls on its own.
 */
export default async function ConsolePage({ searchParams }: { searchParams: Promise<{ f?: string; c?: string }> }) {
  await connection();
  const session = await requireSession("analyst");
  const params = await searchParams;
  const filter = consoleFilter.catch("for_you").parse(params.f);
  const deps = getDeps();
  const analysts = await deps.directory.analysts();
  // Availability is read fresh: the names may come from the cache, whether the analyst is available may not.
  const [list, detail, fresh] = await Promise.all([
    loadList(deps, session.id, { filter, search: undefined }),
    params.c && analysts ? loadDetail(deps, params.c, session.id, analysts) : null,
    deps.ticketService.listAnalysts(),
  ]);
  const me = fresh.ok ? fresh.data.find((analyst) => analyst.id === session.id) : analysts?.get(session.id);
  return (
    <ConsoleApp
      analyst={{ id: session.id, name: session.name, email: session.email }}
      initial={{
        list,
        filter,
        selectedId: detail?.ok ? detail.detail.conversation.id : null,
        detail: detail?.ok ? detail.detail : null,
        available: me?.available ?? true,
      }}
      renderedAt={deps.now().toISOString()}
    />
  );
}
