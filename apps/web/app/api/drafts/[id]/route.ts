import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { editDraftHandler } from "@/lib/server/drafts";

export const PATCH = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  editDraftHandler(request, getDeps(), (await params).id);
