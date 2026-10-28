import { Hono } from "hono";

// People, tickets and articles API. Vercel serves this default export.
const app = new Hono();

export default app;
