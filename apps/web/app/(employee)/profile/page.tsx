import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Card } from "@/components/card";
import { TopBar } from "@/components/top-bar";
import { formatPasswordAge } from "@/lib/format";
import { requireSession } from "@/lib/server/current-session";
import { getDeps } from "@/lib/server/deps";
import { getEmployee } from "@/lib/server/me";
import { ProfileError } from "./profile-error";
import { PasswordCard } from "./password-card";
import { ProfileLayout } from "./profile-layout";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function ProfilePage() {
  await connection();
  const session = await requireSession("employee");
  // Same lookup as GET /api/me, done here so the page arrives ready.
  const result = await getEmployee(session, getDeps().ticketService);

  return (
    <>
      <TopBar here="Meu perfil" />
      <ProfileLayout>
        {!result.ok ? (
          <ProfileError reason={result.reason} />
        ) : (
          <>
            <Card as="section" aria-label="Dados de acesso" className="flex flex-col">
              <Row label="Nome">
                <span className="text-14.5 font-medium text-ink">{result.employee.name}</span>
              </Row>
              <Row label="E-mail corporativo">
                <span className="min-w-0 flex-1 truncate text-14.5 font-medium text-ink">{result.employee.email}</span>
                <span className="flex shrink-0 items-center gap-[5px] text-12.5 text-ink-3">
                  <Lock aria-hidden className="size-[13px]" />
                  Gerenciado pela TI
                </span>
              </Row>
            </Card>

            <PasswordCard
              email={result.employee.email}
              age={formatPasswordAge(result.employee.passwordChangedAt, new Date())}
            />
          </>
        )}
      </ProfileLayout>
    </>
  );
}

// In nexo.pen the divider sits inside the padding; here it adds to it, so the bottom padding gives back 1 px.
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-6 py-5 not-last:border-b not-last:border-rule not-last:pb-[19px]">
      <span className="w-40 shrink-0 text-13.5 text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-3">{children}</div>
    </div>
  );
}
