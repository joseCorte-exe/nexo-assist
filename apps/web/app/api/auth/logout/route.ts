import type { NextRequest } from "next/server";
import { logout } from "@/lib/server/auth";
import { getDeps } from "@/lib/server/deps";

export const POST = (request: NextRequest) => logout(request, getDeps());
