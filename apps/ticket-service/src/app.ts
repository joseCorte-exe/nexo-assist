import { ADMIN_KEY_HEADER, SERVICE_SECRET_HEADER } from "@nexo/shared";
import { Hono } from "hono";
import type { Db } from "./db";
import { errorBody } from "./errors";
import { outage } from "./outage";
import { adminRoutes } from "./routes/admin";
import { ticketRoutes } from "./routes/tickets";

export type Deps = {
  db: Db;
  serviceSecret: string;
  adminKey: string;
  /** Chance (0 to 1) that a request opens an outage window. */
  outageRate: number;
  now: () => Date;
  random: () => number;
};

export function createApp(deps: Deps) {
  const app = new Hono();

  // The service has a public URL, so every route needs the secret only the web knows.
  app.use("*", async (c, next) => {
    if (!deps.serviceSecret || c.req.header(SERVICE_SECRET_HEADER) !== deps.serviceSecret) {
      return c.json(errorBody("unauthorized", "Missing or wrong service secret"), 401);
    }
    await next();
  });

  app.use("/admin/*", async (c, next) => {
    if (!deps.adminKey || c.req.header(ADMIN_KEY_HEADER) !== deps.adminKey) {
      return c.json(errorBody("unauthorized", "Missing or wrong admin key"), 401);
    }
    await next();
  });

  app.use("*", outage(deps));

  app.route("/admin", adminRoutes(deps));
  app.route("/tickets", ticketRoutes(deps));

  app.notFound((c) => c.json(errorBody("not_found", "Route not found"), 404));

  return app;
}
