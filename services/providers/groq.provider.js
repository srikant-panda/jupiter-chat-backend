import { BaseProvider } from "./base.provider.js";
import { KeyPool } from "../keyPool.service.js";
import OpenAI from "openai";

/**
 * GroqProvider integrates Groq API with multi-key pool support.
 * Groq offers ultra-fast inference with generous free-tier quotas.
 */
export class GroqProvider extends BaseProvider {
  constructor({
    keys = process.env.GROQ_API_KEY || "",
    cooldownHours = process.env.API_KEY_COOLDOWN_HOURS || 4,
    freeModel = process.env.GROQ_FREE_MODEL || "openai/gpt-oss-120b",
    weight = 2,
  } = {}) {
    super({
      name: "groq",
      keyPool: new KeyPool({
        providerName: "groq",
        keys,
        cooldownHours,
      }),
      defaultFreeModel: freeModel,
      weight,
    });
  }

  async chat({
    model,
    messages,
    stream = false,
    onToken = null,
    signal = null,
    responseFormat = null,
    tools = null,
  }) {
    if (process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test") {
      const mockTitle = "Test Response";
      const mockAnswer =
        "## Overview\nThis is a mock answer generated for tests without calling external AI APIs.";
      const raw = JSON.stringify({ title: mockTitle, answer: mockAnswer });
      if (onToken) {
        await onToken(mockAnswer);
      }
      return {
        title: mockTitle,
        result: mockAnswer,
        raw,
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        provider: this.name,
        model,
      };
    }
    return this.keyPool.executeWithRetry(async (key) => {
      const client = new OpenAI({
        apiKey: key,
        baseURL: "https://api.groq.com/openai/v1",
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
        const streamResponse = await client.chat.completions.create(params, {
          signal,
        });

        let raw = "";
        for await (const chunk of streamResponse) {
          if (signal?.aborted) {
            throw new Error("Request aborted by timeout or client.");
          }
          if (chunk.error) {
            const err = new Error(chunk.error.message || "Groq provider error");
            err.status = chunk.error.code || 500;
            throw err;
          }
          const delta = chunk.choices?.[0]?.delta?.content || "";
          if (delta) {
            raw += delta;
            if (onToken) await onToken(delta);
          }
          if (chunk.usage) {
            usage.promptTokens = chunk.usage.prompt_tokens || usage.promptTokens;
            usage.completionTokens =
              chunk.usage.completion_tokens || usage.completionTokens;
            usage.totalTokens =
              chunk.usage.total_tokens ||
              usage.promptTokens + usage.completionTokens;
          }
        }
        return { raw, usage, streamed: true };
      } else {
        const response = await client.chat.completions.create(params, {
          signal,
        });

        if (response.error) {
          const err = new Error(response.error.message || "Groq provider error");
          err.status = response.error.code || 500;
          throw err;
        }

        const raw = response.choices?.[0]?.message?.content || "";
        if (response.usage) {
          usage.promptTokens = response.usage.prompt_tokens || 0;
          usage.completionTokens = response.usage.completion_tokens || 0;
          usage.totalTokens =
            response.usage.total_tokens ||
            usage.promptTokens + usage.completionTokens;
        }
        return { raw, usage, streamed: false };
      }
    });
  }
}
