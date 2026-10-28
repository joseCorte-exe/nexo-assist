import { Card } from "@/components/card";
import { TopBar } from "@/components/top-bar";
import { ProfileLayout } from "./profile-layout";

const bar = "block animate-pulse rounded bg-desk";

/** Same shape as the loaded page, so nothing jumps when the data arrives. */
export default function ProfileLoading() {
  return (
    <>
      <TopBar here="Meu perfil" />
      <ProfileLayout>
        <div aria-busy aria-label="Carregando seus dados" className="flex flex-col gap-8">
          <Card className="flex flex-col">
            {[0, 1].map((row) => (
              <div key={row} className="flex h-[58px] items-center gap-4 px-6 not-last:border-b not-last:border-rule">
                <span className={`${bar} h-3.5 w-24`} />
                <span className={`${bar} ml-16 h-4 w-44`} />
              </div>
            ))}
          </Card>
          <Card className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-4 p-6">
              <span className={`${bar} size-10 rounded-full`} />
              <div className="flex flex-1 flex-col gap-2">
                <span className={`${bar} h-4 w-16`} />
                <span className={`${bar} h-3.5 w-32`} />
              </div>
              <span className={`${bar} h-9 w-[150px] rounded-lg`} />
            </div>
            <div className="h-10 border-t border-rule bg-desk" />
          </Card>
        </div>
      </ProfileLayout>
    </>
  );
}
