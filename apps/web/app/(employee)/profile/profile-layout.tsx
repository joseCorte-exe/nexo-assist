import type { ReactNode } from "react";

/** Title and column of the profile, shared by the page and its loading state. */
export function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 justify-center overflow-y-auto px-10 py-12">
      <div className="flex w-[600px] max-w-full flex-col gap-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-24 font-bold tracking-[-0.4px] text-ink">Meu perfil</h1>
          <p className="text-14.5 text-ink-3">Seus dados de acesso ao service desk de TI.</p>
        </div>
        {children}
      </div>
    </main>
  );
}
