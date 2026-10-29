"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquareIcon, UserRoundIcon } from "@/components/design-icons";

const items = [
  { href: "/", label: "Atendimento", icon: MessageSquareIcon },
  { href: "/profile", label: "Meu perfil", icon: UserRoundIcon },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="mt-[22px] flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className="group flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-13.5 font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:bg-desk aria-[current=page]:bg-primary-soft aria-[current=page]:font-semibold aria-[current=page]:text-primary-text"
          >
            <Icon aria-hidden className="size-4 text-ink-3 group-aria-[current=page]:text-primary-text" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
