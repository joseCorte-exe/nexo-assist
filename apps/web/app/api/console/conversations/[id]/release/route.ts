import type { NextRequest } from "next/server";
import { releaseHandler } from "@/lib/server/console/actions";
import { getDeps } from "@/lib/server/deps";

export const POST = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  releaseHandler(request, getDeps(), (await params).id);
