import { BaseProvider } from "./base.provider.js";
import { KeyPool } from "../keyPool.service.js";
import { OpenRouter } from "@openrouter/sdk";
import {
  createStreamReasoningFilter,
  extractThinkReasoning,
} from "../../utils/reasoningParser.js";

/**
 * OpenRouterProvider wraps OpenRouter API calls with multi-key pool support.
 */
export class OpenRouterProvider extends BaseProvider {
  constructor({
    keys = process.env.OPENROUTER_API_KEY || "",
    cooldownHours = process.env.API_KEY_COOLDOWN_HOURS || 4,
    freeModel = process.env.OPENROUTER_FREE_MODEL || "openrouter/free",
    models = process.env.OPENROUTER_MODELS || [],
    weight = 2,
  } = {}) {
    super({
      name: "openrouter",
      keyPool: new KeyPool({
        providerName: "openrouter",
        keys,
        cooldownHours,
      }),
      modelPool: models,
      defaultFreeModel: freeModel,
      weight,
    });
  }

  /**
   * Executes a single chat attempt with key pool retry. Called by BaseProvider.chat() model fallback loop.
   */
  async executeChat({
    model,
    messages,
    stream = false,
    webSearch = false,
    onToken = null,
    onReasoning = null,
    signal = null,
    responseFormat = null,
    tools = null,
  }) {
    return this.keyPool.executeWithRetry(async (key) => {
      const client = new OpenRouter({ apiKey: key });
      return this._executeWithClient(client, {
        model,
        messages,
        stream,
        webSearch,
        onToken,
        onReasoning,
        signal,
        responseFormat,
        tools,
      });
    });
  }

  async _executeWithClient(
    client,
    { model, messages, stream, webSearch, onToken, onReasoning, signal, responseFormat, tools }
  ) {
    const activeTools = tools ? [...tools] : [];
    if (webSearch && !activeTools.some((t) => t.type === "openrouter:web_search")) {
      activeTools.push({
        type: "openrouter:web_search",
        parameters: {
          engine: "auto",
          max_results: 5,
        },
      });
    }

    const chatRequest = {
      model,
      messages,
      stream: Boolean(stream),
      ...(responseFormat ? { responseFormat } : {}),
      ...(activeTools.length > 0 ? { tools: activeTools } : {}),
    };

    const response = await client.chat.send({
      chatRequest,
      options: signal ? { signal } : undefined,
    });

    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    if (stream) {
      const filter = createStreamReasoningFilter({ onToken, onReasoning });

      for await (const chunk of response) {
        if (signal?.aborted) {
          throw new Error("Request aborted by timeout or client.");
        }
        if (chunk.error) {
          const err = new Error(chunk.error.message || "OpenRouter provider error");
          err.status = chunk.error.code || 500;
          throw err;
        }

        // 1. Direct reasoning delta from OpenRouter
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

        if (chunk.usage) {
          usage.promptTokens = chunk.usage.promptTokens || usage.promptTokens;
          usage.completionTokens =
            chunk.usage.completionTokens || usage.completionTokens;
          usage.totalTokens =
            chunk.usage.totalTokens ||
            usage.promptTokens + usage.completionTokens;
        }
      }

      const { raw, reasoning } = await filter.flush();
      return { raw, reasoning, usage, streamed: true };
    } else {
      const choice = response.choices?.[0]?.message;
      let raw = "";
      if (Array.isArray(choice?.content)) {
        raw = choice.content.map((p) => (typeof p === "string" ? p : p.text || "")).join("");
      } else {
        raw = choice?.content || "";
      }

      let reasoning =
        choice?.reasoning || choice?.reasoning_content || "";

      if (!reasoning && raw.includes("<think>")) {
        const extracted = extractThinkReasoning(raw);
        raw = extracted.content;
        reasoning = extracted.reasoning;
      }

      if (response.usage) {
        usage.promptTokens = response.usage.promptTokens || 0;
        usage.completionTokens = response.usage.completionTokens || 0;
        usage.totalTokens =
          response.usage.totalTokens ||
          usage.promptTokens + usage.completionTokens;
      }

      return { raw, reasoning, usage, streamed: false };
    }
  }
}
