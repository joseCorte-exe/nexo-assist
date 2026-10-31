import type { NextRequest } from "next/server";
import { assumeHandler } from "@/lib/server/console/actions";
import { getDeps } from "@/lib/server/deps";

export const POST = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  assumeHandler(request, getDeps(), (await params).id);
