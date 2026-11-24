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

/**
 * FreeRouterService orchestrates dynamic, weighted multi-provider execution
 * for the "free" model tier with timeout cancellation and seamless failover.
 */
export class FreeRouterService {
  constructor({
    timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS) || 12000,
    singleProviderTimeoutMs = Number(process.env.SINGLE_PROVIDER_TIMEOUT_MS) || 60000,
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.singleProviderTimeoutMs = singleProviderTimeoutMs;
    this.providerWeights = new Map();
  }

  /**
   * Selects an available free provider using Smooth Weighted Round-Robin (SWRR).
   */
  pickNextProvider(availableProviders) {
    if (availableProviders.length === 0) {
      throw new AppError(
        "No free AI providers are currently available. All providers are in rate-limit cooldown or unconfigured.",
        503,
        "ALL_FREE_PROVIDERS_UNAVAILABLE"
      );
    }

    if (availableProviders.length === 1) {
      return availableProviders[0];
    }

    // Initialize state in providerWeights map if needed
    for (const p of availableProviders) {
      if (!this.providerWeights.has(p.name)) {
        this.providerWeights.set(p.name, {
          weight: p.weight || 1,
          currentWeight: 0,
        });
      }
    }

    let totalWeight = 0;
    let selected = null;
    let selectedState = null;

    for (const p of availableProviders) {
      const state = this.providerWeights.get(p.name);
      state.currentWeight += state.weight;
      totalWeight += state.weight;

      if (!selectedState || state.currentWeight > selectedState.currentWeight) {
        selected = p;
        selectedState = state;
      }
    }

    if (selectedState) {
      selectedState.currentWeight -= totalWeight;
    }

    return selected || availableProviders[0];
  }

  /**
   * Orders candidate providers for automatic multi-provider execution.
   * Default order: Groq first, then OpenRouter, then Gemini.
   * Can be customized via PROVIDER_ORDER env (e.g. "groq,openrouter,gemini").
   */
  orderCandidateProviders(availableProviders) {
    if (!availableProviders || availableProviders.length <= 1) {
      return availableProviders || [];
    }

    const preferredOrder = (
      process.env.PROVIDER_ORDER
        ? process.env.PROVIDER_ORDER.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
        : ["groq", "openrouter", "gemini"]
    );

    const ordered = [];
    for (const name of preferredOrder) {
      const match = availableProviders.find(
        (p) => (p.name || "").toLowerCase() === name
      );
      if (match && !ordered.includes(match)) {
        ordered.push(match);
      }
    }

    // Append any remaining available providers
    for (const p of availableProviders) {
      if (!ordered.includes(p)) {
        ordered.push(p);
      }
    }

    return ordered.length > 0 ? ordered : availableProviders;
  }

  /**
   * Generates answer using the free tier with timeout cancellation and auto-failover.
   */
  async generateFreeAnswer({ messages, onToken = null, timeoutMs = null }) {
    const limitMs = timeoutMs || this.timeoutMs;
    const available = providerRegistry.getAvailableFreeProviders();

    if (available.length === 0) {
      throw new AppError(
        "No free AI providers are currently available. Please configure API keys or wait for rate-limit cooldowns to expire.",
        503,
        "NO_FREE_PROVIDERS_AVAILABLE"
      );
    }

    // Order candidate providers: groq first, then openrouter, then gemini
    const candidateQueue = this.orderCandidateProviders(available);

    let lastError = null;

    for (let i = 0; i < candidateQueue.length; i++) {
      const provider = candidateQueue[i];
      const model = provider.getFreeModel();
      const hasAlternative = i < candidateQueue.length - 1;

      // When alternative providers exist to failover to, use the fast failover timeout.
      // When this is the only or final available provider, use the extended timeout (e.g. 60s)
      // so we wait patiently for the response without prematurely aborting.
      const currentTimeoutMs = hasAlternative
        ? limitMs
        : (this.singleProviderTimeoutMs || Math.max(limitMs * 4, 60000));

      console.log(
        `[FreeRouter] Routing free request to provider "${provider.name}" (model: ${model}) with timeout ${currentTimeoutMs}ms (${
          hasAlternative ? "failover enabled" : "final/only provider, extended wait"
        })...`
      );

      const abortController = new AbortController();
      let timer = null;
      let tokensEmitted = false;
      const chunks = [];
      const decode = createAnswerDecoder();

      try {
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            abortController.abort();
            const err = new Error(
              `Provider "${provider.name}" exceeded wait timeout of ${currentTimeoutMs}ms.`
            );
            err.code = "PROVIDER_TIMEOUT";
            reject(err);
          }, currentTimeoutMs);
        });

        const chatMessages = [responseInstruction, ...messages];
        let reqFormat = responseFormat;

        const executePromise = (async () => {
          try {
            return await provider.chat({
              model,
              messages: chatMessages,
              stream: Boolean(onToken),
              signal: abortController.signal,
              responseFormat: reqFormat,
              onToken: onToken
                ? async (delta) => {
                    // Reset timeout timer on successful token emission
                    if (timer) clearTimeout(timer);
                    chunks.push(delta);
                    const decoded = decode(delta);
                    if (decoded) {
                      tokensEmitted = true;
                      await onToken(decoded);
                    }
                  }
                : undefined,
            });
          } catch (err) {
            // If structured outputs rejected, try without responseFormat
            if (reqFormat && unsupportedFormat(err)) {
              reqFormat = null;
              return await provider.chat({
                model,
                messages: chatMessages,
                stream: Boolean(onToken),
                signal: abortController.signal,
                onToken: onToken
                  ? async (delta) => {
                      if (timer) clearTimeout(timer);
                      chunks.push(delta);
                      const decoded = decode(delta);
                      if (decoded) {
                        tokensEmitted = true;
                        await onToken(decoded);
                      }
                    }
                  : undefined,
              });
            }
            throw err;
          }
        })();

        const response = await Promise.race([executePromise, timeoutPromise]);
        if (timer) clearTimeout(timer);

        const raw = chunks.length > 0 ? chunks.join("") : response.raw || "";
        const parsed = parseRobustAnswer(raw);

        if (onToken && !tokensEmitted && parsed.result) {
          await onToken(parsed.result);
        }

        console.log(
          `[FreeRouter] Successfully completed response via provider "${provider.name}".`
        );
        return {
          ...parsed,
          usage: response.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          provider: provider.name,
          model,
        };
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastError = err;

        console.warn(
          `[FreeRouter] Provider "${provider.name}" failed: ${err.message}`
        );

        // If tokens were already emitted to client stream, cannot seamlessly restart stream
        if (tokensEmitted) {
          throw new AppError(
            "Stream was interrupted during generation. Please retry.",
            502,
            "STREAM_INTERRUPTED"
          );
        }

        // If more candidate providers remain, failover seamlessly
        if (i < candidateQueue.length - 1) {
          console.log(
            `[FreeRouter] Seamlessly switching to next available provider "${candidateQueue[i + 1].name}"...`
          );
          continue;
        }
      }
    }

    throw (
      lastError ||
      new AppError(
        "All available free providers failed to complete the response. Please retry in a few moments.",
        502,
        "FREE_TIER_EXHAUSTED"
      )
    );
  }
}

export const freeRouterService = new FreeRouterService();
export default freeRouterService;
