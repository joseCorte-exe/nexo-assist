import { serve } from "@hono/node-server";
import app from "./index";

// Local only. On Vercel the bundle of index.ts is served.
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ticket-service on http://localhost:${info.port}`);
});
