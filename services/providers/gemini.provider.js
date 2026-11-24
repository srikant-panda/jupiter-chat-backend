import { BaseProvider } from "./base.provider.js";
import { KeyPool } from "../keyPool.service.js";
import OpenAI from "openai";

/**
 * GeminiProvider integrates Google Gemini with multi-key pool support.
 * Uses Gemini's official OpenAI-compatible endpoint with streaming support.
 */
export class GeminiProvider extends BaseProvider {
  constructor({
    keys = process.env.GEMINI_API_KEY || "",
    cooldownHours = process.env.API_KEY_COOLDOWN_HOURS || 4,
    freeModel = process.env.GEMINI_FREE_MODEL || "gemini-3.5-flash",
    weight = 2,
  } = {}) {
    super({
      name: "gemini",
      keyPool: new KeyPool({
        providerName: "gemini",
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
    return this.keyPool.executeWithRetry(async (key) => {
      // Intercept Google error responses returning arrays [{ error: ... }] so OpenAI SDK formats them cleanly
      const customFetch = async (url, init) => {
        const res = await fetch(url, init);
        if (!res.ok) {
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            if (Array.isArray(data) && data[0]?.error) {
              return new Response(JSON.stringify(data[0]), {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers,
              });
            }
          } catch {}
          return new Response(text, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
        return res;
      };

      const client = new OpenAI({
        apiKey: key,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        fetch: customFetch,
      });

      // Normalize model ID: lowercase, dashes instead of spaces, strip prefixes
      const targetModel = (model || this.defaultFreeModel)
        .replace(/^(gemini\/|google\/)/i, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");

      // Filter messages to clean role/content. Map "developer" to "system" for standard OpenAI-compat endpoints
      const cleanMessages = messages.map((m) => ({
        role: m.role === "developer" ? "system" : m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      }));

      let formattedResponseFormat;
      if (responseFormat) {
        formattedResponseFormat = {
          type: "json_schema",
          json_schema: {
            name: "jupiter_answer",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: {
                  type: "string",
                  description:
                    "A specific conversation title: 3–8 words, at most 60 characters.",
                },
                answer: {
                  type: "string",
                  description:
                    "The complete, detailed answer in Markdown.",
                },
              },
              required: ["title", "answer"],
            },
          },
        };
      }

      const params = {
        model: targetModel,
        messages: cleanMessages,
        stream: Boolean(stream),
        ...(formattedResponseFormat ? { response_format: formattedResponseFormat } : {}),
      };

      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      const createCompletion = async (reqPayload) => {
        try {
          return await client.chat.completions.create(reqPayload, { signal });
        } catch (err) {
          // If strict json_schema rejected, fallback to json_object
          if (reqPayload.response_format?.type === "json_schema") {
            return await client.chat.completions.create(
              { ...reqPayload, response_format: { type: "json_object" } },
              { signal }
            );
          }
          throw err;
        }
      };

      if (stream) {
        const streamResponse = await createCompletion(params);

        let raw = "";
        for await (const chunk of streamResponse) {
          if (signal?.aborted) {
            throw new Error("Request aborted by timeout or client.");
          }
          if (Array.isArray(chunk) && chunk[0]?.error) {
            const err = new Error(chunk[0].error.message || "Gemini provider error");
            err.status = chunk[0].error.code || 500;
            throw err;
          }
          if (chunk.error) {
            const err = new Error(chunk.error.message || "Gemini provider error");
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
        const response = await createCompletion(params);

        if (Array.isArray(response) && response[0]?.error) {
          const err = new Error(response[0].error.message || "Gemini provider error");
          err.status = response[0].error.code || 500;
          throw err;
        }
        if (response.error) {
          const err = new Error(response.error.message || "Gemini provider error");
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
