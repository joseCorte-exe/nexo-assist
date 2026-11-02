import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { presenceHandler } from "@/lib/server/presence";

export const POST = (request: NextRequest) => presenceHandler(request, getDeps());
