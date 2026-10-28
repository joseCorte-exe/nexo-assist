import type { NextRequest } from "next/server";
import { login } from "@/lib/server/auth";
import { getDeps } from "@/lib/server/deps";

export const POST = (request: NextRequest) => login(request, getDeps());
