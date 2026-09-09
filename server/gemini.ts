import { explanationSchema } from "./ai";
import type { Config } from "./config";

export type GeminiUsage = {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
};

export type GeminiGeneration = {
  text: string;
  modelVersion: string;
  usage: GeminiUsage;
};

export class GeminiGenerationError extends Error {
  constructor(
    message: string,
    public usage?: GeminiUsage,
    public modelVersion?: string,
  ) {
    super(message);
  }
}

type GeminiChunk = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
};

function count(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

async function consumeSse(
  body: ReadableStream<Uint8Array>,
  accept: (chunk: GeminiChunk) => Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const dispatch = async () => {
    if (!data.length) return;
    const payload = data.join("\n");
    data = [];
    if (payload !== "[DONE]") await accept(JSON.parse(payload));
  };
  const line = async (value: string) => {
    if (!value) return dispatch();
    if (value.startsWith("data:")) data.push(value.slice(5).trimStart());
  };
  for (;;) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const item of lines) await line(item.replace(/\r$/, ""));
    if (chunk.done) break;
  }
  if (buffer) await line(buffer.replace(/\r$/, ""));
  await dispatch();
}

export function estimateGeminiCost(
  usage: GeminiUsage,
  env = process.env,
) {
  const inputRate = Number(env.GEMINI_INPUT_USD_PER_MILLION ?? 0.1);
  const outputRate = Number(env.GEMINI_OUTPUT_USD_PER_MILLION ?? 0.4);
  if (![inputRate, outputRate].every((rate) => Number.isFinite(rate) && rate >= 0))
    throw new Error("Gemini token prices must be non-negative numbers.");
  return (
    usage.inputTokens * inputRate
    + (usage.outputTokens + usage.thoughtTokens) * outputRate
  ) / 1_000_000;
}

export async function generateWithGemini(
  config: Config,
  messages: { system: string; user: string },
  onText: (text: string) => Promise<void>,
  request: typeof fetch = fetch,
): Promise<GeminiGeneration> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`;
  const response = await request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.geminiApiKey,
    },
    redirect: "error",
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS ?? 120_000)),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: messages.system }] },
      contents: [{ role: "user", parts: [{ text: messages.user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 600),
        responseMimeType: "application/json",
        responseJsonSchema: explanationSchema,
      },
    }),
  });
  if (!response.ok || !response.body)
    throw new Error(`GEMINI_REQUEST_FAILED_${response.status}`);

  let text = "";
  let modelVersion = config.model;
  let finishReason = "";
  let blocked = "";
  const usage: GeminiUsage = {
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    totalTokens: 0,
  };
  try {
    await consumeSse(response.body, async (chunk) => {
      blocked = chunk.promptFeedback?.blockReason || blocked;
      modelVersion = chunk.modelVersion || modelVersion;
      const candidate = chunk.candidates?.[0];
      finishReason = candidate?.finishReason || finishReason;
      for (const part of candidate?.content?.parts || []) {
        if (typeof part.text === "string") text += part.text;
      }
      if (text.length > 100_000) throw new Error("GEMINI_RESPONSE_TOO_LARGE");
      const metadata = chunk.usageMetadata;
      if (metadata) {
        usage.inputTokens = Math.max(usage.inputTokens, count(metadata.promptTokenCount));
        usage.outputTokens = Math.max(usage.outputTokens, count(metadata.candidatesTokenCount));
        usage.thoughtTokens = Math.max(usage.thoughtTokens, count(metadata.thoughtsTokenCount));
        usage.totalTokens = Math.max(usage.totalTokens, count(metadata.totalTokenCount));
      }
      await onText(text);
    });
  } catch (error) {
    throw new GeminiGenerationError(
      error instanceof Error ? error.message : "GEMINI_STREAM_FAILED",
      usage.totalTokens ? usage : undefined,
      modelVersion,
    );
  }
  if (!usage.totalTokens)
    usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.thoughtTokens;
  if (blocked) throw new GeminiGenerationError(`GEMINI_PROMPT_BLOCKED_${blocked}`, usage, modelVersion);
  if (finishReason && finishReason !== "STOP")
    throw new GeminiGenerationError(`GEMINI_FINISH_${finishReason}`, usage, modelVersion);
  if (!text.trim()) throw new GeminiGenerationError("GEMINI_EMPTY_RESPONSE", usage, modelVersion);
  if (!usage.inputTokens || !usage.totalTokens)
    throw new GeminiGenerationError("GEMINI_USAGE_MISSING", usage, modelVersion);
  return { text, modelVersion, usage };
}
