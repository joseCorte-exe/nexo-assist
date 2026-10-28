import type { KbArticle } from "@nexo/shared";

export type SearchableArticle = KbArticle & { keywords: string[] };

const MAX_RESULTS = 3;
const KEYWORD_SCORE = 3;
const TITLE_SCORE = 2;
const CONTENT_SCORE = 1;

// Words that say nothing about the problem. Written without accents, as normalize leaves them.
const STOPWORDS = new Set(
  (
    "a o as os ao aos de do da dos das e em no na nos nas num numa um uma uns umas que se nao sim " +
    "eu me mim meu minha meus minhas seu sua seus suas voce ele ela isso isto esse essa este esta " +
    "para pra pro por com sem ou mas mais muito ja tem ter esta estou estao foi ser sou ha da dar " +
    "qual quais como onde quando porque oi ola bom boa dia tarde noite obrigado obrigada favor"
  ).split(" "),
);

/** Lowercase, without accents, with anything that is not a letter or a digit turned into a space. */
function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const words = (text: string) => normalize(text).split(" ").filter((word) => word.length > 1 && !STOPWORDS.has(word));

/**
 * Ranks the help center for a question in the employee's own words, best first, at most three.
 * A whole keyword of the article in the question is worth 3, a word of the question in the title 2, in the text 1.
 * Case and accents never matter, and keywords only match as whole words ("rh" is not inside "rhythm").
 */
export function rankArticles<T extends SearchableArticle>(query: string, articles: readonly T[]): T[] {
  const padded = ` ${normalize(query)} `;
  const queryWords = new Set(words(query));
  if (queryWords.size === 0) return [];

  return articles
    .map((article) => {
      const title = new Set(words(article.title));
      const content = new Set(words(article.content));
      let score = 0;
      for (const keyword of article.keywords) {
        const phrase = normalize(keyword);
        if (phrase && padded.includes(` ${phrase} `)) score += KEYWORD_SCORE;
      }
      for (const word of queryWords) {
        if (title.has(word)) score += TITLE_SCORE;
        if (content.has(word)) score += CONTENT_SCORE;
      }
      return { article, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id))
    .slice(0, MAX_RESULTS)
    .map(({ article }) => article);
}
