import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { confirmDraftHandler } from "@/lib/server/drafts";

export const POST = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  confirmDraftHandler(request, getDeps(), (await params).id);
