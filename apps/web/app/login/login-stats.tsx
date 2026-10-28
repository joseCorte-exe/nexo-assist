import { connection } from "next/server";
import type { ReactNode } from "react";
import { formatCount, formatDuration, formatPercent } from "@/lib/format";
import { getDeps } from "@/lib/server/deps";
import { getLoginStats } from "@/lib/server/stats";

/** The three numbers, computed on the server with the same function as GET /api/stats/login. */
export async function LoginStats() {
  await connection();
  const stats = await getLoginStats(getDeps());
  return (
    <StatsList
      values={[
        formatDuration(stats.firstResponseSeconds),
        formatPercent(stats.resolvedWithoutQueuePercent),
        <>
          {formatCount(stats.analystsOnline)}
          {stats.analystsOnline ? <span aria-hidden className="size-2 rounded-full bg-success" /> : null}
        </>,
      ]}
    />
  );
}

export function LoginStatsSkeleton() {
  const block = <span className="my-[5px] block h-8 w-14 animate-pulse rounded-md bg-[#FFFFFF14]" />;
  return <StatsList values={[block, block, block]} busy />;
}

const labels = ["primeira resposta, em média", "resolvidos sem fila", "analistas online agora"];

function StatsList({ values, busy = false }: { values: ReactNode[]; busy?: boolean }) {
  return (
    <ul
      aria-label="Números do service desk"
      aria-busy={busy}
      className="grid w-full grid-cols-3 border-t border-[#FFFFFF1A] pt-6"
    >
      {labels.map((label, index) => (
        <li
          key={label}
          className="flex flex-col gap-1.5 not-first:border-l not-first:border-[#FFFFFF1A] not-first:pl-[23px]"
        >
          <span className="flex items-center gap-2 font-display text-34 tracking-[-0.6px] whitespace-nowrap text-white">
            {values[index]}
          </span>
          <span className="text-13.5 whitespace-nowrap text-[#FFFFFF8C]">{label}</span>
        </li>
      ))}
    </ul>
  );
}
