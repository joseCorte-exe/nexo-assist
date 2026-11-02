import { presenceInput, type PresenceResponse } from "@nexo/shared";
import { type NextRequest, NextResponse } from "next/server";
import { conversations } from "@/db/schema";
import { activeConversationOf } from "./conversation";
import type { Deps } from "./deps";
import { readBody, readEmployeeSession } from "./http";

/** How long "digitando…" lasts after the last keystroke the chat reported. */
export const TYPING_MS = 6_000;

/**
 * POST /api/conversation/presence. The chat says it is open, and whether she is writing: one update of her active
 * conversation, found by the partial unique index. It answers the state, so the chat learns an analyst took the
 * conversation without polling while the agent has it.
 */
export async function presenceHandler(request: NextRequest, deps: Deps) {
  const session = await readEmployeeSession(request, deps);
  if (!session.ok) return session.response;
  const body = await readBody(request, presenceInput);
  if (!body.ok) return body.response;
  const now = deps.now();
  const [conversation] = await deps.db
    .update(conversations)
    .set({ employeeSeenAt: now, employeeTypingUntil: body.data.typing ? new Date(now.getTime() + TYPING_MS) : null })
    .where(activeConversationOf(session.session.id))
    .returning({ id: conversations.id, state: conversations.state });
  return NextResponse.json<PresenceResponse>({ conversation: conversation ?? null }, { headers: { "cache-control": "no-store" } });
}
