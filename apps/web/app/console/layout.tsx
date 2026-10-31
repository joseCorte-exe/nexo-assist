import type { ReactNode } from "react";
import { requireSession } from "@/lib/server/current-session";

/** Only analysts reach the console. The rail, the list and the rest live in the page, which keeps them in step. */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  await requireSession("analyst");
  return children;
}
