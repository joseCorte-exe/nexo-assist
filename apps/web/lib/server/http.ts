import type { ApiError } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import type { Deps } from "./deps";
import { type Session, SESSION_COOKIE, verifySession } from "./session";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

export const unauthorized = () => jsonError(401, "unauthorized", "Sua sessão terminou. Entre de novo.");

export const serviceUnavailable = () =>
  jsonError(503, "service_unavailable", "O serviço de chamados não respondeu. Tente de novo em instantes.");

export function readSession(request: NextRequest, deps: Deps): Promise<Session | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token, deps.sessionSecret, deps.now()) : Promise.resolve(null);
}

/** Parses the JSON body with the contract schema. On failure, the response carries the first problem found. */
export async function readBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  const json: unknown = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const message = json === undefined ? "Corpo da requisição inválido." : (parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return { ok: false, response: jsonError(400, "invalid_body", message) };
}
