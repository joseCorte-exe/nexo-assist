import type { KbArticle } from "@nexo/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app";
import { errorBody } from "../errors";
import { kbArticles } from "../db/schema";
import { rankArticles } from "../kb-search";

const searchQuery = z.object({ q: z.string().trim().min(1).max(200) });

export function kbRoutes(deps: Deps) {
  return new Hono().get("/search", async (c) => {
    const parsed = searchQuery.safeParse(c.req.query());
    if (!parsed.success) return c.json(errorBody("invalid_query", "q must have from 1 to 200 characters"), 400);

    // The help center has a handful of short articles, so ranking all of them in memory is cheaper than an index.
    const articles = await deps.db.select().from(kbArticles);
    const ranked = rankArticles(parsed.data.q, articles);
    return c.json(ranked.map(({ id, title, content, category }): KbArticle => ({ id, title, content, category })));
  });
}
