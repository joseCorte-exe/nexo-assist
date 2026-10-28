import type { NextRequest } from "next/server";
import { getDeps } from "@/lib/server/deps";
import { resetPassword } from "@/lib/server/me";

export const POST = (request: NextRequest) => resetPassword(request, getDeps());
