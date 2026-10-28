import type { NextRequest } from "next/server";
import { chat } from "@/lib/server/chat";
import { getDeps } from "@/lib/server/deps";

// The agent stops itself at 45 s; this leaves room to save the reply after it.
export const maxDuration = 60;

export const POST = (request: NextRequest) => chat(request, getDeps());
