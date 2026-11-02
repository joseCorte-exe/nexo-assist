import type { NextRequest } from "next/server";
import { availabilityHandler } from "@/lib/server/console/availability";
import { getDeps } from "@/lib/server/deps";

export const PATCH = (request: NextRequest) => availabilityHandler(request, getDeps());
