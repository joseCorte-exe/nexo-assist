import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { LOGIN_PATH } from "@/lib/route-guard";
import type { Role } from "@nexo/shared";
import { getDeps } from "./deps";
import { type Session, SESSION_COOKIE, sessionFrom } from "./session";

/** The session of the current page request, verified once per render. */
export const getCurrentSession = cache(async (): Promise<Session | null> => {
  // Cookies first: reading them is what tells Next the page is per request, before any configuration is read.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const deps = getDeps();
  return sessionFrom(token, deps.sessionSecret, deps.now());
});

/** For pages: the session of the given role, or a redirect to the login. The proxy already checked this optimistically. */
export async function requireSession(role: Role): Promise<Session> {
  const session = await getCurrentSession();
  if (!session || session.role !== role) redirect(LOGIN_PATH);
  return session;
}
