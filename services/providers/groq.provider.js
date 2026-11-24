import { BaseProvider } from "./base.provider.js";
import { KeyPool } from "../keyPool.service.js";
import Groq from "groq-sdk";
import {
  createStreamReasoningFilter,
  extractThinkReasoning,
} from "../../utils/reasoningParser.js";

/**
 * GroqProvider integrates Groq API with multi-key pool support
 * using Groq's official SDK (groq-sdk) and real Server-Sent Events (SSE) streaming.
 * Groq offers ultra-fast inference with generous free-tier quotas.
 */
export class GroqProvider extends BaseProvider {
  constructor({
    keys = process.env.GROQ_API_KEY || "",
    cooldownHours = process.env.API_KEY_COOLDOWN_HOURS || 4,
    freeModel = process.env.GROQ_FREE_MODEL || "llama-3.3-70b-versatile",
    models = process.env.GROQ_MODELS || [],
    weight = 3,
  } = {}) {
    super({
      name: "groq",
      keyPool: new KeyPool({
        providerName: "groq",
        keys,
        cooldownHours,
      }),
      modelPool: models,
      defaultFreeModel: freeModel,
      weight,
    });
  }

  async executeChat({
    model,
    messages,
    stream = false,
    onToken = null,
    onReasoning = null,
    signal = null,
    responseFormat = null,
    tools = null,
  }) {
    return this.keyPool.executeWithRetry(async (key) => {
      const client = new Groq({
        apiKey: key,
      });

      // Filter messages to roles Groq supports (system, user, assistant)
      const cleanMessages = messages.map((m) => ({
        role: m.role === "developer" ? "system" : m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));

      // Groq supports response_format: { type: "json_object" }
      let formattedResponseFormat;
      if (responseFormat) {
        formattedResponseFormat = { type: "json_object" };
      }

      const params = {
        model,
        messages: cleanMessages,
        stream: Boolean(stream),
        ...(formattedResponseFormat ? { response_format: formattedResponseFormat } : {}),
      };

      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (stream) {
        // Groq SDK returns an async iterable of Server-Sent Event (SSE) chunks
        const streamResponse = await client.chat.completions.create(params, {
          signal,
        });

        const filter = createStreamReasoningFilter({ onToken, onReasoning });

        for await (const chunk of streamResponse) {
          if (signal?.aborted) {
            throw new Error("Request aborted by timeout or client.");
          }
          if (chunk.error) {
            const err = new Error(chunk.error.message || "Groq provider error");
            err.status = chunk.error.code || 500;
            throw err;
          }

          // 1. Direct reasoning delta (e.g. DeepSeek-R1 models on Groq)
          const reasoningDelta =
            chunk.choices?.[0]?.delta?.reasoning ||
            chunk.choices?.[0]?.delta?.reasoning_content ||
            "";
          if (reasoningDelta) {
            await filter.handleReasoning(reasoningDelta);
          }

          // 2. Content delta (may contain inline <think> tags)
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (delta) {
            await filter.handleContent(delta);
          }

          if (chunk.x_groq?.usage) {
            usage.promptTokens = chunk.x_groq.usage.prompt_tokens || usage.promptTokens;
            usage.completionTokens =
              chunk.x_groq.usage.completion_tokens || usage.completionTokens;
            usage.totalTokens =
              chunk.x_groq.usage.total_tokens ||
              usage.promptTokens + usage.completionTokens;
          } else if (chunk.usage) {
            usage.promptTokens = chunk.usage.prompt_tokens || usage.promptTokens;
            usage.completionTokens =
              chunk.usage.completion_tokens || usage.completionTokens;
            usage.totalTokens =
              chunk.usage.total_tokens ||
              usage.promptTokens + usage.completionTokens;
          }
        }

        const { raw, reasoning } = await filter.flush();
        return { raw, reasoning, usage, streamed: true };
      } else {
        const response = await client.chat.completions.create(params, {
          signal,
        });

        if (response.error) {
          const err = new Error(response.error.message || "Groq provider error");
          err.status = response.error.code || 500;
          throw err;
        }

        const choice = response.choices?.[0]?.message;
        let raw = choice?.content || "";
        let reasoning =
          choice?.reasoning || choice?.reasoning_content || "";

        if (!reasoning && raw.includes("<think>")) {
          const extracted = extractThinkReasoning(raw);
          raw = extracted.content;
          reasoning = extracted.reasoning;
        }

        if (response.usage) {
          usage.promptTokens = response.usage.prompt_tokens || 0;
          usage.completionTokens = response.usage.completion_tokens || 0;
          usage.totalTokens =
            response.usage.total_tokens ||
            usage.promptTokens + usage.completionTokens;
        }
        return { raw, reasoning, usage, streamed: false };
      }
    });
  }
}
