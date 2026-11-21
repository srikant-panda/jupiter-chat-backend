import openRouter from "../config/openrouter.js";
import {
  responseFormat,
  responseInstruction,
  parseAnswer,
  createAnswerDecoder,
  unsupportedFormat,
} from "../utils/responseSchema.js";

export async function generateAnswer({
  model,
  messages,
  onToken,
  client = openRouter,
}) {
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
      const parsed = parseAnswer(raw);
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
