import { type NextRequest, NextResponse } from "next/server";
import { getSessionSecret, SESSION_COOKIE, sessionFrom } from "@/lib/server/session";
import { guardRoute } from "@/lib/route-guard";

/** Keeps each person on the pages of their role. An optimistic check: pages and API routes verify again. */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await sessionFrom(token, getSessionSecret(), new Date());

  const target = guardRoute(request.nextUrl.pathname, session?.role ?? null);
  const response = target ? NextResponse.redirect(new URL(target, request.url)) : NextResponse.next();
  // A cookie that no longer verifies (forged, expired, old secret) is dropped so it is not sent again.
  if (token && !session) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
