import { type Analyst, availabilityInput } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import type { Deps } from "../deps";
import { readAnalystSession, readBody, serviceUnavailable } from "../http";

/** PATCH /api/console/me. The "Disponível" of the console, kept in the ticket-service, which owns the analysts. */
export async function availabilityHandler(request: NextRequest, deps: Deps) {
  const session = await readAnalystSession(request, deps);
  if (!session.ok) return session.response;
  const body = await readBody(request, availabilityInput);
  if (!body.ok) return body.response;
  const result = await deps.ticketService.setAvailability(session.session.id, body.data.available);
  if (!result.ok) return serviceUnavailable();
  // The login counts the analysts online, and the console reads them: the cached ones are old now.
  deps.directory.forgetAnalysts();
  return NextResponse.json<Analyst>(result.data);
}
