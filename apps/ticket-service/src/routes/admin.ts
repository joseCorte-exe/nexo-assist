import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import { openOutageWindow } from "../outage";
import { seed } from "../seed";

const outageQuery = z.object({ seconds: z.coerce.number().int().min(1).max(300) });

export function adminRoutes(deps: Deps) {
  return new Hono()
    .post("/outage", async (c) => {
      const parsed = outageQuery.safeParse(c.req.query());
      if (!parsed.success) return c.json(errorBody("invalid_query", "seconds must be an integer from 1 to 300"), 400);
      const unavailableUntil = await openOutageWindow(deps.db, deps.now(), parsed.data.seconds);
      return c.json({ unavailableUntil: unavailableUntil.toISOString() });
    })
    .post("/reseed", async (c) => {
      await seed(deps.db, deps.now());
      return c.json({ ok: true });
    });
}
