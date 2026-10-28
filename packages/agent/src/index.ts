// Mastra: agent, tools, instructions and the models that stand in for the LLM.
export { createMemory, createNexoAgent, type NexoAgent, streamReply, type Turn, type TurnResult } from "./agent";
export type { HelpCenter } from "./tools";
export { simulatedModel } from "./models/simulated";

/** The model of the agent: Claude Haiku 5.5, or the simulated one when NEXO_AGENT_MODEL=simulated. */
export const AGENT_MODEL = "anthropic/claude-haiku-5-5";
