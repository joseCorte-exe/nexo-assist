import type { NextRequest } from "next/server";
import { listHandler } from "@/lib/server/console/list";
import { getDeps } from "@/lib/server/deps";

export const GET = (request: NextRequest) => listHandler(request, getDeps());
