import type { NextRequest } from "next/server";
import { closeHandler } from "@/lib/server/console/actions";
import { getDeps } from "@/lib/server/deps";

export const POST = async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  closeHandler(request, getDeps(), (await params).id);
