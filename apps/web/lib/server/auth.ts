import { loginInput, type LoginResponse } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { Deps } from "./deps";
import { jsonError, readBody, serviceUnavailable } from "./http";
import { createSession, sessionCookieOptions, signSession } from "./session";

/** POST /api/auth/login. Any non-empty password works (ARQUITETURA.md, section 1). */
export async function login(request: NextRequest, deps: Deps) {
  const body = await readBody(request, loginInput);
  if (!body.ok) return body.response;
  const { email, remember } = body.data;

  const result = await deps.ticketService.findPersonByEmail(email);
  if (!result.ok) return serviceUnavailable();
  const person = result.data;
  if (!person) return jsonError(401, "email_not_found", "E-mail não encontrado.");

  const token = await signSession(createSession(person, { remember, now: deps.now() }), deps.sessionSecret);
  const response = NextResponse.json<LoginResponse>({ role: person.role });
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
