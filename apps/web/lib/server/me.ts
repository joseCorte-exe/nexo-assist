import {
  type Employee,
  type MeResponse,
  type Person,
  resetPasswordInput,
  type ResetPasswordResponse,
} from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { Deps } from "./deps";
import { readBody, readSession, serviceUnavailable, unauthorized } from "./http";
import type { Session } from "./session";

type Failure = { ok: false; reason: "not_found" | "service_unavailable" };

/**
 * The signed-in person, read again from the ticket-service so the profile shows current data
 * (the session only carries what the sidebar needs). Someone else now holding the e-mail counts as not found.
 */
export async function getMe(
  session: Session,
  ticketService: Deps["ticketService"],
): Promise<{ ok: true; me: Person } | Failure> {
  const result = await ticketService.findPersonByEmail(session.email);
  if (!result.ok) return { ok: false, reason: "service_unavailable" };
  const person = result.data;
  if (!person || person.id !== session.id || person.role !== session.role) return { ok: false, reason: "not_found" };
  return { ok: true, me: person };
}

/** The profile page is for employees only, so this is where the person stops being employee-or-analyst. */
export async function getEmployee(
  session: Session,
  ticketService: Deps["ticketService"],
): Promise<{ ok: true; employee: Employee } | Failure> {
  const result = await getMe(session, ticketService);
  if (!result.ok) return result;
  if (result.me.role !== "employee") return { ok: false, reason: "not_found" };
  const { role: _role, ...employee } = result.me;
  return { ok: true, employee };
}

/** GET /api/me. */
export async function me(request: NextRequest, deps: Deps) {
  const session = await readSession(request, deps);
  if (!session) return unauthorized();

  const result = await getMe(session, deps.ticketService);
  if (result.ok) return NextResponse.json<MeResponse>(result.me);
  return result.reason === "not_found" ? unauthorized() : serviceUnavailable();
}

/**
 * POST /api/me/reset-password. Only answers the notice: no e-mail is sent (ARQUITETURA.md, section 1).
 * It answers the same for any e-mail, so it does not reveal who exists.
 */
export async function resetPassword(request: NextRequest, _deps: Deps) {
  const body = await readBody(request, resetPasswordInput);
  if (!body.ok) return body.response;
  return NextResponse.json<ResetPasswordResponse>({
    notice: `Enviamos um link de redefinição para ${body.data.email}.`,
  });
}
