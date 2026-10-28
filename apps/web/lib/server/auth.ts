import { loginInput, type LoginResponse } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { Deps } from "./deps";
import { jsonError, readBody, serviceUnavailable } from "./http";
import { createSession, sessionCookieOptions, type SessionUser, signSession } from "./session";

export type AuthResult =
  { ok: true; user: SessionUser } | { ok: false; reason: "email_not_found" | "service_unavailable" };

/**
 * Who owns the e-mail. Employees and analysts are looked up at the same time; an employee wins a tie.
 * "Not found" is only said when both lookups answered, so an outage never reads as a wrong e-mail.
 */
export async function authenticate(email: string, ticketService: Deps["ticketService"]): Promise<AuthResult> {
  const [employee, analysts] = await Promise.all([
    ticketService.findEmployeeByEmail(email),
    ticketService.listAnalysts(),
  ]);

  if (employee.ok && employee.data) {
    const { id, name } = employee.data;
    return { ok: true, user: { role: "employee", id, name, email: employee.data.email } };
  }
  const analyst = analysts.ok ? analysts.data.find((candidate) => candidate.email === email) : undefined;
  if (analyst) return { ok: true, user: { role: "analyst", id: analyst.id, name: analyst.name, email: analyst.email } };

  return { ok: false, reason: employee.ok && analysts.ok ? "email_not_found" : "service_unavailable" };
}

/** POST /api/auth/login. Any non-empty password works (ARQUITETURA.md, section 1). */
export async function login(request: NextRequest, deps: Deps) {
  const body = await readBody(request, loginInput);
  if (!body.ok) return body.response;
  const { email, remember } = body.data;

  const result = await authenticate(email, deps.ticketService);
  if (!result.ok) {
    return result.reason === "email_not_found"
      ? jsonError(401, "email_not_found", "E-mail não encontrado.")
      : serviceUnavailable();
  }

  const token = await signSession(createSession(result.user, { remember, now: deps.now() }), deps.sessionSecret);
  const response = NextResponse.json<LoginResponse>({ role: result.user.role });
  response.cookies.set({ ...sessionCookieOptions({ remember, secure: deps.secureCookies }), value: token });
  return response;
}

/** POST /api/auth/logout. */
export async function logout(_request: NextRequest, deps: Deps) {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set({
    ...sessionCookieOptions({ remember: false, secure: deps.secureCookies }),
    value: "",
    expires: new Date(0),
  });
  return response;
}
