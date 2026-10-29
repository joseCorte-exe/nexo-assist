import { z } from "zod";
import { category } from "./domain";

/** An article of the help center, as GET /kb/search answers it. */
export const kbArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  category,
});
export type KbArticle = z.infer<typeof kbArticleSchema>;
