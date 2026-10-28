import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4StreamResult,
} from "@ai-sdk/provider";

/** One step of a model that is not the real LLM: the tool calls it makes, or the text it writes. */
export type ModelStep = { toolCalls: Array<{ toolName: string; input: unknown }> } | { text: string };

type Options = {
  /** Wait between the parts, so a screen can show the reply arriving. */
  delayMs?: number;
};

const usage = (output: number) => ({
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

/** The parts a provider would stream for the step: text in a few chunks, or the tool calls. */
export function stepParts(step: ModelStep, callId: string): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
  if ("text" in step) {
    const id = `${callId}-text`;
    parts.push({ type: "text-start", id });
    // Word by word, like a real provider, so the screen shows the reply arriving in parts.
    for (const delta of step.text.match(/\S+\s*/g) ?? []) parts.push({ type: "text-delta", id, delta });
    parts.push({ type: "text-end", id });
    parts.push({ type: "finish", usage: usage(step.text.length), finishReason: { unified: "stop", raw: "end_turn" } });
    return parts;
  }
  step.toolCalls.forEach(({ toolName, input }, index) => {
    parts.push({ type: "tool-call", toolCallId: `${callId}-tool-${index}`, toolName, input: JSON.stringify(input) });
  });
  parts.push({ type: "finish", usage: usage(1), finishReason: { unified: "tool-calls", raw: "tool_use" } });
  return parts;
}

export function streamOf(parts: LanguageModelV4StreamPart[], { delayMs = 0 }: Options = {}): LanguageModelV4StreamResult {
  let index = 0;
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      async pull(controller) {
        const part = parts[index++];
        if (!part) return controller.close();
        if (delayMs > 0 && part.type === "text-delta") await new Promise((resolve) => setTimeout(resolve, delayMs));
        controller.enqueue(part);
      },
    }),
  };
}

/** A language model whose every step is decided by code, for tests and for running without an LLM key. */
export function codedModel(
  modelId: string,
  nextStep: (options: LanguageModelV4CallOptions, callNumber: number) => ModelStep | Promise<ModelStep>,
  options: Options = {},
): LanguageModelV4 & { calls: LanguageModelV4CallOptions[] } {
  const calls: LanguageModelV4CallOptions[] = [];
  const doStream = async (callOptions: LanguageModelV4CallOptions) => {
    calls.push(callOptions);
    const step = await nextStep(callOptions, calls.length);
    return streamOf(stepParts(step, `call-${calls.length}`), options);
  };
  return {
    specificationVersion: "v4",
    provider: "nexo",
    modelId,
    supportedUrls: {},
    calls,
    doStream,
    doGenerate: async () => {
      throw new Error(`${modelId} only streams`);
    },
  };
}
