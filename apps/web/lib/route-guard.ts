import type { Role } from "@nexo/shared";

export const LOGIN_PATH = "/login";

export function homeOf(role: Role): string {
  return role === "analyst" ? "/console" : "/";
}

const isConsole = (pathname: string) => pathname === "/console" || pathname.startsWith("/console/");

/**
 * Where a page request must be sent instead, or null to let it through.
 * The API routes check the session again on their own; this only keeps people on the pages of their role.
 */
export function guardRoute(pathname: string, role: Role | null): string | null {
  if (pathname === LOGIN_PATH) return role ? homeOf(role) : null;
  if (!role) return LOGIN_PATH;
  if (role === "employee" && isConsole(pathname)) return homeOf(role);
  if (role === "analyst" && !isConsole(pathname)) return homeOf(role);
  return null;
}
