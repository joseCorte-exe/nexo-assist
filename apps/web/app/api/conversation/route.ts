import type { NextRequest } from "next/server";
import { conversationHandler } from "@/lib/server/conversation";
import { getDeps } from "@/lib/server/deps";

export const GET = (request: NextRequest) => conversationHandler(request, getDeps());
