import { type MeResponse, resetPasswordInput, type ResetPasswordResponse } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { Deps } from "./deps";
import { jsonError, readBody, readSession, serviceUnavailable, unauthorized } from "./http";
import type { Session } from "./session";

export type MeResult = { ok: true; me: MeResponse } | { ok: false; reason: "not_found" | "service_unavailable" };

/**
 * The signed-in person, read again from the ticket-service so the profile shows current data
 * (the session only carries what the sidebar needs).
 */
export async function getMe(session: Session, ticketService: Deps["ticketService"]): Promise<MeResult> {
  if (session.role === "employee") {
    const result = await ticketService.findEmployeeByEmail(session.email);
    if (!result.ok) return { ok: false, reason: "service_unavailable" };
    if (!result.data || result.data.id !== session.sub) return { ok: false, reason: "not_found" };
    return { ok: true, me: { role: "employee", ...result.data } };
  }

  const result = await ticketService.listAnalysts();
  if (!result.ok) return { ok: false, reason: "service_unavailable" };
  const analyst = result.data.find((candidate) => candidate.id === session.sub);
  return analyst ? { ok: true, me: { role: "analyst", ...analyst } } : { ok: false, reason: "not_found" };
}

/** GET /api/me. */
export async function me(request: NextRequest, deps: Deps) {
  const session = await readSession(request, deps);
  if (!session) return unauthorized();

  const result = await getMe(session, deps.ticketService);
  if (result.ok) return NextResponse.json<MeResponse>(result.me);
  return result.reason === "not_found" ? unauthorized() : serviceUnavailable();
}

export const resetNotice = (email: string) => `Enviamos um link de redefinição para ${email}.`;

/**
 * POST /api/me/reset-password. Only answers the notice: no e-mail is sent (ARQUITETURA.md, section 1).
 * Signed out ("Esqueci minha senha"), it answers the same for any e-mail, so it does not reveal who exists.
 */
export async function resetPassword(request: NextRequest, deps: Deps) {
  const session = await readSession(request, deps);
  const body = await readBody(request, resetPasswordInput);
  if (!body.ok && !session) return body.response;

  const email = session?.email ?? (body.ok ? body.data.email : undefined);
  if (!email) return jsonError(400, "email_required", "Digite seu e-mail corporativo para receber o link.");
  return NextResponse.json<ResetPasswordResponse>({ notice: resetNotice(email) });
}
