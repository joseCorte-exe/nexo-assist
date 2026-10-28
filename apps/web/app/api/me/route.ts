import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { me } from "@/lib/server/me";

export const GET = (request: NextRequest) => me(request, getDeps());
