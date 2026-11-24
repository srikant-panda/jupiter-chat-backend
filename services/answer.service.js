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

async function executeCustomProvider({ provider, model, messages, onToken }) {
  const decode = createAnswerDecoder();
  const chunks = [];
  let tokensEmitted = false;
  let reqFormat = responseFormat;
  const chatMessages = [responseInstruction, ...messages];

  let response;
  try {
    response = await provider.chat({
      model,
      messages: chatMessages,
      stream: Boolean(onToken),
      responseFormat: reqFormat,
      onToken: onToken
        ? async (delta) => {
            chunks.push(delta);
            const text = decode(delta);
            if (text) {
              tokensEmitted = true;
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
        onToken: onToken
          ? async (delta) => {
              chunks.push(delta);
              const text = decode(delta);
              if (text) {
                tokensEmitted = true;
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

  if (onToken && !tokensEmitted && parsed.result) {
    await onToken(parsed.result);
  }

  return {
    ...parsed,
    usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    provider: provider.name,
    model,
  };
}

export async function generateAnswer({
  model,
  provider: providerHint,
  messages,
  onToken,
  client = openRouter,
}) {
  const isTestMode =
    process.env.TEST_MODE === "true" || process.env.NODE_ENV === "test";

  // If the request is for the dynamic free model and client is not a custom mock in test
  const isMockedClient =
    client !== openRouter ||
    (openRouter &&
      typeof openRouter.chat?.send === "function" &&
      openRouter.chat.send !== Object.getPrototypeOf(openRouter).chat?.send);

  if (!isMockedClient) {
    if (
      model === "free" ||
      model === "openrouter/free" ||
      providerHint === "Auto (Multi-Provider)"
    ) {
      return freeRouterService.generateFreeAnswer({ messages, onToken });
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
        onToken,
      });
    }
  }

  // If in test mode and no custom mock client was supplied, return mocked answer without calling external API
  if (isTestMode && !isMockedClient) {
    const mockTitle = "Test Response";
    const mockAnswer =
      "## Overview\nThis is a mock answer generated for tests without calling external AI APIs.";
    if (onToken) {
      await onToken(mockAnswer);
    }
    return {
      title: mockTitle,
      result: mockAnswer,
      usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
      provider: providerHint || "openrouter",
      model,
    };
  }
  const chatRequest = {
    model,
    messages: [responseInstruction, ...messages],
    responseFormat,
    provider: { requireParameters: true },
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
        const content = response.choices?.[0]?.message?.content;
        raw = Array.isArray(content)
          ? content
              .map((p) => (typeof p === "string" ? p : p.text || ""))
              .join("")
          : content || "";
        track(response.usage);
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
      return { ...parsed, usage };
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
        /(?:tools?|web.?search).*?(?:not support|unsupported|not available)|(?:not support|unsupported).*?(?:tools?|web.?search)/i.test(
          err.message || "",
        )
      ) {
        delete chatRequest.tools;
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
