import { BaseProvider } from "./base.provider.js";
import { KeyPool } from "../keyPool.service.js";
import { GoogleGenAI, Type } from "@google/genai";
import {
  createStreamReasoningFilter,
  extractThinkReasoning,
} from "../../utils/reasoningParser.js";

/**
 * GeminiProvider integrates Google Gemini with multi-key pool support
 * using Google's official Gen AI SDK (@google/genai) from Google AI Studio.
 */
export class GeminiProvider extends BaseProvider {
  constructor({
    keys = process.env.GEMINI_API_KEY || "",
    cooldownHours = process.env.API_KEY_COOLDOWN_HOURS || 4,
    freeModel = process.env.GEMINI_FREE_MODEL || "gemini-2.0-flash",
    models = process.env.GEMINI_MODELS || [],
    weight = 1,
  } = {}) {
    super({
      name: "gemini",
      keyPool: new KeyPool({
        providerName: "gemini",
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
      const ai = new GoogleGenAI({ apiKey: key });

      // Normalize model ID: lowercase, strip prefixes
      const targetModel = (model || this.defaultFreeModel)
        .replace(/^(gemini\/|google\/)/i, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");

      // Extract system instructions and format conversation contents
      const systemParts = [];
      const nonSystemMessages = [];

      for (const m of messages) {
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (m.role === "system" || m.role === "developer") {
          systemParts.push(text);
        } else {
          nonSystemMessages.push({
            role: m.role === "assistant" ? "model" : "user",
            text,
          });
        }
      }

      // Merge consecutive turns with the same role (Gemini requires alternating roles)
      const contents = [];
      for (const msg of nonSystemMessages) {
        if (contents.length > 0 && contents[contents.length - 1].role === msg.role) {
          contents[contents.length - 1].parts.push({ text: msg.text });
        } else {
          contents.push({
            role: msg.role,
            parts: [{ text: msg.text }],
          });
        }
      }

      // Gemini requires contents to start with role 'user' and not be empty
      if (contents.length === 0) {
        contents.push({ role: "user", parts: [{ text: "Hello" }] });
      } else if (contents[0].role === "model") {
        contents.unshift({ role: "user", parts: [{ text: "Start" }] });
      }

      const config = {};

      if (systemParts.length > 0) {
        config.systemInstruction = systemParts.join("\n\n");
      }

      if (signal) {
        config.abortSignal = signal;
      }

      if (responseFormat) {
        config.responseMimeType = "application/json";
        config.responseSchema = {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "A specific conversation title: 3–8 words, at most 60 characters.",
            },
            answer: {
              type: Type.STRING,
              description: "The complete, detailed answer in Markdown.",
            },
          },
          required: ["title", "answer"],
        };
      } else if (tools && tools.length > 0) {
        const hasWebSearch = tools.some(
          (t) =>
            t.type === "openrouter:web_search" ||
            t.type === "web_search" ||
            t.googleSearch
        );
        if (hasWebSearch) {
          config.tools = [{ googleSearch: {} }];
        }
      }

      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (stream) {
        const responseStream = await ai.models.generateContentStream({
          model: targetModel,
          contents,
          config,
        });

        const filter = createStreamReasoningFilter({ onToken, onReasoning });

        for await (const chunk of responseStream) {
          if (signal?.aborted) {
            throw new Error("Request aborted by timeout or client.");
          }

          const candidate = chunk.candidates?.[0];
          let processedParts = false;

          if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.thought) {
                processedParts = true;
                if (part.text) await filter.handleReasoning(part.text);
              } else if (part.text) {
                processedParts = true;
                await filter.handleContent(part.text);
              }
            }
          }

          if (!processedParts) {
            const text = chunk.text || "";
            if (text) {
              await filter.handleContent(text);
            }
          }

          if (chunk.usageMetadata) {
            usage.promptTokens = chunk.usageMetadata.promptTokenCount || usage.promptTokens;
            usage.completionTokens =
              chunk.usageMetadata.candidatesTokenCount || usage.completionTokens;
            usage.totalTokens =
              chunk.usageMetadata.totalTokenCount ||
              usage.promptTokens + usage.completionTokens;
          }
        }

        const { raw, reasoning } = await filter.flush();
        return { raw, reasoning, usage, streamed: true };
      } else {
        const response = await ai.models.generateContent({
          model: targetModel,
          contents,
          config,
        });

        const candidate = response.candidates?.[0];
        let raw = "";
        let reasoning = "";

        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.thought) {
              reasoning += part.text || "";
            } else if (part.text) {
              raw += part.text;
            }
          }
        }

        if (!raw && !reasoning) {
          raw = response.text || "";
        }

        if (!reasoning && raw.includes("<think>")) {
          const extracted = extractThinkReasoning(raw);
          raw = extracted.content;
          reasoning = extracted.reasoning;
        }

        if (response.usageMetadata) {
          usage.promptTokens = response.usageMetadata.promptTokenCount || 0;
          usage.completionTokens = response.usageMetadata.candidatesTokenCount || 0;
          usage.totalTokens =
            response.usageMetadata.totalTokenCount ||
            usage.promptTokens + usage.completionTokens;
        }
        return { raw, reasoning, usage, streamed: false };
      }
    });
  }
}
