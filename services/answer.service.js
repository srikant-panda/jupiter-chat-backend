import openRouter from "../config/openrouter.js";
import freeRouterService from "./freeRouter.service.js";
import providerRegistry from "./providers/providerRegistry.js";
import { AppError } from "../utils/appError.js";
import {
  responseFormat,
  responseInstruction,
  parseAnswer,
  parseRobustAnswer,
  createAnswerDecoder,
  unsupportedFormat,
} from "../utils/responseSchema.js";
import {
  createStreamReasoningFilter,
  extractThinkReasoning,
} from "../utils/reasoningParser.js";

async function executeCustomProvider({ provider, model, messages, webSearch = false, onToken, onReasoning }) {
  const decode = createAnswerDecoder();
  const chunks = [];
  let answerTokensEmitted = false;
  let reqFormat = responseFormat;
  const chatMessages = [responseInstruction, ...messages];

  let response;
  try {
    response = await provider.chat({
      model,
      messages: chatMessages,
      stream: Boolean(onToken),
      webSearch,
      responseFormat: reqFormat,
      onReasoning,
      onToken: onToken
        ? async (delta) => {
            chunks.push(delta);
            const text = decode(delta);
            if (text) {
              answerTokensEmitted = true;
              await onToken(text);
            }
          }
        : undefined,
    });
  } catch (err) {
    if (reqFormat && unsupportedFormat(err)) {
      reqFormat = null;
      response = await provider.chat({
        model,
        messages: chatMessages,
        stream: Boolean(onToken),
        webSearch,
        onReasoning,
        onToken: onToken
          ? async (delta) => {
              chunks.push(delta);
              const text = decode(delta);
              if (text) {
                answerTokensEmitted = true;
                await onToken(text);
              }
            }
          : undefined,
      });
    } else {
      throw err;
    }
  }

  const raw = chunks.length > 0 ? chunks.join("") : response.raw || "";
  const parsed = parseRobustAnswer(raw);

  if (onToken && !answerTokensEmitted && parsed.result) {
    await onToken(parsed.result);
  }

  return {
    ...parsed,
    reasoning: response.reasoning || "",
    usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    provider: provider.name,
    model,
  };
}

export async function generateAnswer({
  model,
  provider: providerHint,
  messages,
  webSearch = true,
  onToken,
  onReasoning,
  client = openRouter,
}) {
  if (
    model === "free" ||
    providerHint === "Auto (Multi-Provider)"
  ) {
    return freeRouterService.generateFreeAnswer({ messages, webSearch, onToken, onReasoning });
  }

  const { provider, model: targetModel } = providerRegistry.resolveProviderForModel(
    model,
    providerHint
  );

  if (provider && provider.name !== "openrouter") {
    if (!provider.isConfigured()) {
      throw new AppError(
        `Provider "${provider.name}" is not configured. Please add ${provider.name.toUpperCase()}_API_KEY in your .env file.`,
        400,
        "PROVIDER_NOT_CONFIGURED"
      );
    }
    return executeCustomProvider({
      provider,
      model: targetModel,
      messages,
      webSearch,
      onToken,
      onReasoning,
    });
  }
  const chatRequest = {
    model,
    messages: [responseInstruction, ...messages],
    responseFormat,
    provider: { requireParameters: true },
    ...(webSearch
      ? {
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
          toolChoice: "auto",
        }
      : {}),
  };
  let emitted = "";
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const track = (u) => {
    if (!u) return;
    usage.promptTokens += u.promptTokens || 0;
    usage.completionTokens += u.completionTokens || 0;
    usage.totalTokens +=
      u.totalTokens ?? (u.promptTokens || 0) + (u.completionTokens || 0);
  };
  // Unsupported models still receive the format instructions, and their final
  // output is validated by the same schema. Authentication/quota errors never retry.
  for (let attempt = 0; attempt < 4; attempt++) {
    let raw = "";
    let reasoningAccum = "";
    const chunks = [];
    let size = 0;
    const decode = createAnswerDecoder();
    try {
      const response = await client.chat.send({
        chatRequest: { ...chatRequest, stream: Boolean(onToken) },
      });
      if (onToken) {
        let latestUsage;
        for await (const chunk of response) {
          if (chunk.error)
            throw Object.assign(
              new Error(chunk.error.message || "Provider failed"),
              { status: chunk.error.code },
            );

          const reasoningDelta =
            chunk.choices?.[0]?.delta?.reasoning ||
            chunk.choices?.[0]?.delta?.reasoning_content ||
            "";
          if (reasoningDelta) {
            reasoningAccum += reasoningDelta;
            if (onReasoning) await onReasoning(reasoningDelta);
          }

          const content = chunk.choices?.[0]?.delta?.content || "";
          chunks.push(content);
          size += content.length;
          if (size > 250000)
            throw new Error("Response exceeded the supported length.");
          if (chunk.usage) latestUsage = chunk.usage;
          const text = decode(content);
          if (text) {
            await onToken(text);
            emitted += text;
          }
        }
        raw = chunks.join("");
        track(latestUsage);
      } else {
        const choice = response.choices?.[0]?.message;
        const content = choice?.content;
        raw = Array.isArray(content)
          ? content
              .map((p) => (typeof p === "string" ? p : p.text || ""))
              .join("")
          : content || "";
        reasoningAccum =
          choice?.reasoning || choice?.reasoning_content || "";
        track(response.usage);
      }

      if (!reasoningAccum && raw.includes("<think>")) {
        const extracted = extractThinkReasoning(raw);
        raw = extracted.content;
        reasoningAccum = extracted.reasoning;
      }

      let parsed;
      try {
        parsed = parseAnswer(raw);
      } catch (err) {
        if (attempt < 2 && (err instanceof SyntaxError || err.name === "ZodError")) {
          throw err;
        }
        parsed = parseRobustAnswer(raw);
      }
      if (onToken && !emitted && parsed.result) {
        await onToken(parsed.result);
      }
      return { ...parsed, reasoning: reasoningAccum, usage };
    } catch (err) {
      if (emitted)
        throw new Error(
          "The response was interrupted or had an invalid format. Please retry.",
        );
      if ([401, 402, 403, 429].includes(Number(err.status || err.statusCode)))
        throw err;
      if (chatRequest.responseFormat && unsupportedFormat(err)) {
        delete chatRequest.responseFormat;
        delete chatRequest.provider;
        continue;
      }
      if (
        chatRequest.tools &&
        /(?:tools?|web.?search).*?(?:not support|unsupported|not available)|(?:not support|unsupported).*?(?:tools?|web.?search)|tool.*?choice|called a tool/i.test(
          err.message || "",
        )
      ) {
        delete chatRequest.tools;
        delete chatRequest.toolChoice;
        continue;
      }
      if (
        onToken &&
        /(?:stream|sse).*?(?:unsupported|not support|disabled)|(?:not support).*?stream/i.test(
          err.message || "",
        )
      ) {
        const result = await generateAnswer({ model, messages, client });
        await onToken(result.result);
        return result;
      }
      if (
        (err instanceof SyntaxError || err.name === "ZodError") &&
        attempt < 2
      ) {
        // Bounded repair requests with the same context; never display malformed JSON.
        chatRequest.messages = [
          ...chatRequest.messages,
          {
            role: "system",
            content:
              "Your previous output was invalid. Return a valid JSON object with only nonempty title and answer strings; escape newlines and quotes correctly.",
          },
        ];
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    "The model could not produce a valid answer. Try another model.",
  );
}
