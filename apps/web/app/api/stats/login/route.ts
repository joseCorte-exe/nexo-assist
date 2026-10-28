import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { loginStatsHandler } from "@/lib/server/stats";

export const GET = (request: NextRequest) => loginStatsHandler(request, getDeps());
