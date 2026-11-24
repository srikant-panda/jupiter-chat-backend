import providerRegistry from "./providers/providerRegistry.js";
import freeRouterService from "./freeRouter.service.js";

/**
 * Generates non-streaming AI completions for internal background services (such as conversation summaries).
 */
export const generateAIResponse = async ({ model, provider: providerHint, messages }) => {
  if (model === "free" || providerHint === "Auto (Multi-Provider)") {
    const freeRes = await freeRouterService.generateFreeAnswer({ messages });
    return {
      result: freeRes.result,
      usage: freeRes.usage,
    };
  }

  const { provider, model: targetModel } = providerRegistry.resolveProviderForModel(
    model,
    providerHint
  );

  const response = await provider.chat({
    model: targetModel,
    messages,
    stream: false,
  });

  return {
    result: response.raw,
    usage: response.usage,
  };
};
