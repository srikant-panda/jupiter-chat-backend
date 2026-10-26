import openRouter from "../config/openrouter.js";

export const generateAIResponse = async ({ model, messages }) => {
  const completion = await openRouter.chat.send({
    chatRequest: {
      model: model,
      messages: messages,
    },
  });

  let result = completion.choices?.[0]?.message?.content;
  if (Array.isArray(result)) {
    result = result.map((p) => (typeof p === "string" ? p : p.text || "")).join("");
  }

  if (result === undefined || result === null) {
    throw new Error("Cannot get AI response.");
  }

  const promptTokens = completion.usage?.promptTokens || 0;
  const completionTokens = completion.usage?.completionTokens || 0;
  return {
    result,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
};
