import type {
  ConversationPart,
  DecisionRecord,
  RedirectOutOfScopeOutput,
  SearchArticlesOutput,
} from "@nexo/shared";
import type { UIMessage } from "ai";

/** The tools of the agent as the screen sees them in the stream, with the schemas of the contract. */
export type NexoTools = {
  recordDecision: { input: DecisionRecord; output: { recorded: true } };
  searchArticles: { input: { query: string }; output: SearchArticlesOutput };
  redirectOutOfScope: { input: { area: string }; output: RedirectOutOfScopeOutput };
};

/** A message of the chat stream: text, the parts of each tool and the transient data-conversation part. */
export type NexoUIMessage = UIMessage<never, { conversation: ConversationPart }, NexoTools>;
