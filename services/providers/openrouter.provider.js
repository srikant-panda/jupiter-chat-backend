import { BaseProvider } from "./base.provider.js";
import { KeyPool } from "../keyPool.service.js";
import { OpenRouter } from "@openrouter/sdk";

/**
 * OpenRouterProvider wraps OpenRouter API calls with multi-key pool support.
 */
export class OpenRouterProvider extends BaseProvider {
  constructor({
    keys = process.env.OPENROUTER_API_KEY || "",
    cooldownHours = process.env.API_KEY_COOLDOWN_HOURS || 4,
    freeModel = process.env.OPENROUTER_FREE_MODEL || "openrouter/free",
    weight = 1,
  } = {}) {
    super({
      name: "openrouter",
      keyPool: new KeyPool({
        providerName: "openrouter",
        keys,
        cooldownHours,
      }),
      defaultFreeModel: freeModel,
      weight,
    });
  }

  /**
   * Overrides chat to use OpenRouter SDK with key pool rotation.
   */
  async chat({
    model,
    messages,
    stream = false,
    onToken = null,
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
        onToken,
        signal,
        responseFormat,
        tools,
      });
    });
  }

  async _executeWithClient(
    client,
    { model, messages, stream, onToken, signal, responseFormat, tools }
  ) {
    const chatRequest = {
      model,
      messages,
      stream: Boolean(stream),
      ...(responseFormat ? { responseFormat } : {}),
      ...(tools ? { tools } : {}),
    };

    const response = await client.chat.send({
      chatRequest,
      options: signal ? { signal } : undefined,
    });

    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    if (stream) {
      let raw = "";
      for await (const chunk of response) {
        if (signal?.aborted) {
          throw new Error("Request aborted by timeout or client.");
        }
        if (chunk.error) {
          const err = new Error(chunk.error.message || "OpenRouter provider error");
          err.status = chunk.error.code || 500;
          throw err;
        }

        const delta = chunk.choices?.[0]?.delta?.content || "";
        if (delta) {
          raw += delta;
          if (onToken) await onToken(delta);
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
      return { raw, usage, streamed: true };
    } else {
      const content = response.choices?.[0]?.message?.content;
      const raw = Array.isArray(content)
        ? content.map((p) => (typeof p === "string" ? p : p.text || "")).join("")
        : content || "";

      if (response.usage) {
        usage.promptTokens = response.usage.promptTokens || 0;
        usage.completionTokens = response.usage.completionTokens || 0;
        usage.totalTokens =
          response.usage.totalTokens ||
          usage.promptTokens + usage.completionTokens;
      }
      return { raw, usage, streamed: false };
    }
  }
}
