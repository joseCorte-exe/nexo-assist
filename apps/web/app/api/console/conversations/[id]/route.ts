import type { NextRequest } from "next/server";
import { detailHandler } from "@/lib/server/console/detail";
import { getDeps } from "@/lib/server/deps";

export const GET = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  detailHandler(request, getDeps(), (await params).id);
