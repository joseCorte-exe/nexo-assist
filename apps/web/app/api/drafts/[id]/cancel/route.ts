import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { cancelDraftHandler } from "@/lib/server/drafts";

export const POST = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  cancelDraftHandler(request, getDeps(), (await params).id);
