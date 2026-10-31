import type { NextRequest } from "next/server";
import { ticketsPanelHandler } from "@/lib/server/console/panel";
import { getDeps } from "@/lib/server/deps";

export const GET = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  ticketsPanelHandler(request, getDeps(), (await params).id);
