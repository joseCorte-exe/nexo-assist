import { type NexoAgent, streamReply, type Turn } from "./agent";
import { codedModel, type ModelStep } from "./models/stream";

export type { ModelStep };

/**
 * A model that plays the given steps in order, one per call, and records each call. For tests only.
 * A step can be a function, to answer with what the call received.
 */
export function scriptedModel(steps: Array<ModelStep | Error>) {
  return codedModel("scripted", (_options, callNumber) => {
    const step = steps[callNumber - 1];
    if (!step) throw new Error(`The script has ${steps.length} steps and the agent asked for step ${callNumber}`);
    if (step instanceof Error) throw step;
    return step;
  });
}

/** Text of the prompt a model call received, flattened, to assert on what the model saw. */
export function promptText(options: { prompt: Array<{ content: unknown }> }) {
  return JSON.stringify(options.prompt.map((message) => message.content));
}

/** Runs one reply to the end: its text and the tools it called, in order. Rejects when the model failed. */
export async function replyOf(agent: NexoAgent, turn: Turn) {
  const full = await (await streamReply(agent, turn)).getFullOutput();
  if (full.error) throw full.error;
  const toolCalls = full.steps.flatMap((step) =>
    step.toolCalls.map(({ payload }) => ({ toolName: payload.toolName, args: payload.args })),
  );
  return { text: full.text, toolCalls };
}
