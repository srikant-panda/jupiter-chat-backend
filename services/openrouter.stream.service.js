import openRouter from "../config/openrouter.js";
import { generateAIResponse } from "./openrouter.service.js";

/**
 * Checks whether an error is caused by the model or provider not supporting streaming or tools.
 */
export function isStreamingNotSupportedError(err) {
  if (!err) return false;

  const status = err.status || err.statusCode || err.response?.status;
  // Auth, payment, and rate-limit errors are not streaming capability issues
  if (status === 401 || status === 402 || status === 429) {
    return false;
  }

  const rawMsg =
    err.message ||
    err.error?.message ||
    err.response?.data?.error?.message ||
    (typeof err.error === "string" ? err.error : "") ||
    "";
  const msg = rawMsg.toLowerCase();

  const streamKeywords = ["stream", "streaming", "sse"];
  const unsupportedKeywords = [
    "not supported",
    "unsupported",
    "not support",
    "does not support",
    "cannot stream",
    "disabled",
    "not available",
    "invalid parameter",
    "unrecognized parameter",
    "unknown parameter",
  ];

  const hasStream = streamKeywords.some((k) => msg.includes(k));
  const hasUnsupported = unsupportedKeywords.some((k) => msg.includes(k));

  if (hasStream && hasUnsupported) return true;
  if (msg.includes("provider does not support")) return true;
  if (msg.includes("tools not supported") || msg.includes("does not support tools")) return true;
  if (msg.includes("cannot get ai response")) return true;
  if (msg.includes("no content received from stream")) return true;

  // Status 400 or 422 where stream or unsupported is mentioned
  if ((status === 400 || status === 422) && (hasStream || hasUnsupported)) {
    return true;
  }

  // Any 400 or 422 error thrown when initiating a streaming request:
  // often upstream providers reject stream: true or tools with a generic 400 error
  if (status === 400 || status === 422) {
    return true;
  }

  return false;
}

/**
 * Streams an OpenRouter chat completion using the same SDK/configuration.
 * If the model does not support streaming, it falls back to the classic
 * non-streaming request-response service.
 */
export async function generateAIResponseStream({
  model,
  messages,
  onToken,
  onUsage,
}) {
  let tokensEmitted = false;

  try {
    const stream = await openRouter.chat.send({
      chatRequest: {
        model,
        messages,
        tools: [
          {
            type: "openrouter:web_search",
            parameters: {
              engine: "auto",
              max_results: 5,
              max_total_results: 20,
              search_context_size: "auto",
              allowed_domains: [],
              excluded_domains: [],
            },
          },
        ],
        stream: true,
      },
    });

    let result = "";
    let usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let buffer = "";

    for await (const chunk of stream) {
      if (chunk.error) {
        throw new Error(chunk.error.message || JSON.stringify(chunk.error));
      }

      const content = chunk.choices?.[0]?.delta?.content;

      if (content) {
        result += content;
        buffer += content;

        // Flush when we reach a natural boundary
        if (
          buffer.length >= 80 ||
          buffer.includes("\n") ||
          buffer.endsWith(". ") ||
          buffer.endsWith("! ") ||
          buffer.endsWith("? ")
        ) {
          tokensEmitted = true;
          if (onToken) await onToken(buffer);
          buffer = "";
        }
      }

      if (chunk.usage) {
        const promptTokens = chunk.usage.promptTokens || 0;
        const completionTokens = chunk.usage.completionTokens || 0;
        const totalTokens =
          chunk.usage.totalTokens || promptTokens + completionTokens;

        usage = {
          promptTokens,
          completionTokens,
          totalTokens,
        };
      }
    }

    // Flush any remaining characters in the buffer
    if (buffer) {
      tokensEmitted = true;
      if (onToken) await onToken(buffer);
      buffer = "";
    }

    if (!result) {
      throw new Error("No content received from stream.");
    }

    if (onUsage) await onUsage(usage);
    return { result, usage, streamed: true };
  } catch (err) {
    if (!tokensEmitted && isStreamingNotSupportedError(err)) {
      console.warn(
        `[Stream Fallback] Model "${model}" does not support streaming (${err.message}). Falling back to classic request-response...`
      );
      const fallback = await generateAIResponse({ model, messages });
      if (onToken && fallback.result) {
        await onToken(fallback.result);
      }
      if (onUsage && fallback.usage) {
        await onUsage(fallback.usage);
      }
      return { ...fallback, streamed: false };
    }

    throw err;
  }
}
