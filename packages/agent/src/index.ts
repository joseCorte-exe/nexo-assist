// Mastra: agent, tools, instructions and the models that stand in for the LLM.
export {
  type AgentMemory,
  type AgentModel,
  createMemory,
  createNexoAgent,
  type NexoAgent,
  SCREEN_NOTE,
  saveNote,
  streamReply,
  type Turn,
} from "./agent";
export type { DraftRecord, DraftStore, TicketDesk } from "./tools";
export { simulatedModel } from "./models/simulated";

/** The model of the agent: Claude Haiku 5.5, or the simulated one when NEXO_AGENT_MODEL=simulated. */
export const AGENT_MODEL = "anthropic/claude-haiku-5-5";
