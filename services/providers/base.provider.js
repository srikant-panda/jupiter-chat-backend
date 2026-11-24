import { AppError } from "../../utils/appError.js";

/**
 * BaseProvider defines the common contract for all AI model providers.
 * Supports KeyPool for multi-key rotation and ModelPool for automatic model failover.
 */
export class BaseProvider {
  constructor({
    name,
    keyPool,
    modelPool = [],
    defaultFreeModel = null,
    weight = 1,
  }) {
    this.name = name;
    this.keyPool = keyPool;
    this.modelPool = this._parseModelList(modelPool);
    this.defaultFreeModel = defaultFreeModel;
    this.weight = Math.max(1, Number(weight) || 1);
  }

  _parseModelList(raw) {
    if (Array.isArray(raw)) {
      return raw.map((m) => (typeof m === "string" ? m.trim() : "")).filter(Boolean);
    }
    if (typeof raw === "string") {
      return raw.split(",").map((m) => m.trim()).filter(Boolean);
    }
    return [];
  }

  /**
   * Set or update the model pool for this provider.
   */
  setModelPool(models) {
    this.modelPool = this._parseModelList(models);
  }

  /**
   * Returns current configured models in the pool.
   */
  getModelPool() {
    return [...this.modelPool];
  }

  /**
   * Whether this provider has a configured model pool.
   */
  hasModelPool() {
    return this.modelPool.length > 0;
  }

  /**
   * Returns candidate models in priority order:
   * 1. The requested model (if specified)
   * 2. Fallback models from modelPool (excluding duplicate of requested model)
   * 3. defaultFreeModel (if list is still empty)
   */
  getModelCandidates(requestedModel) {
    const cleanRequested = (requestedModel || "").trim();
    const candidates = [];

    if (cleanRequested && cleanRequested !== "free" && cleanRequested !== "openrouter/free") {
      candidates.push(cleanRequested);
    } else if (this.defaultFreeModel) {
      candidates.push(this.defaultFreeModel);
    }

    for (const m of this.modelPool) {
      if (m && !candidates.includes(m)) {
        candidates.push(m);
      }
    }

    if (candidates.length === 0 && this.defaultFreeModel) {
      candidates.push(this.defaultFreeModel);
    }

    return candidates;
  }

  /**
   * Whether this provider has at least one API key configured in env.
   */
  isConfigured() {
    return Boolean(this.keyPool && this.keyPool.totalKeys > 0);
  }

  /**
   * Whether this provider has at least one API key not in rate-limit cooldown.
   */
  isAvailable() {
    return Boolean(this.isConfigured() && this.keyPool.hasAvailableKey());
  }

  /**
   * Whether this provider can participate in the dynamic "free" model pool.
   */
  hasFreeModel() {
    return Boolean(this.isAvailable() && (this.defaultFreeModel || this.modelPool.length > 0));
  }

  /**
   * Returns the model name used for free tier queries.
   */
  getFreeModel() {
    return this.defaultFreeModel || (this.modelPool.length > 0 ? this.modelPool[0] : null);
  }

  /**
   * Executes chat completion with automatic model fallback across this provider's model pool.
   * Tries each candidate model in the pool at most once (bounded, never searches forever).
   */
  async chat({
    model,
    messages,
    stream = false,
    onToken = null,
    signal = null,
    responseFormat = null,
    tools = null,
  }) {
    const candidates = this.getModelCandidates(model);

    if (candidates.length === 0) {
      throw new AppError(
        `No model specified and model pool is empty for provider "${this.name}".`,
        400,
        "NO_MODEL_AVAILABLE"
      );
    }

    let lastError = null;
    let tokensEmitted = false;
    const wrappedOnToken = onToken
      ? async (chunk) => {
          tokensEmitted = true;
          await onToken(chunk);
        }
      : null;

    for (let i = 0; i < candidates.length; i++) {
      const candidateModel = candidates[i];
      if (signal?.aborted) {
        throw new Error("Request aborted by client or timeout.");
      }

      try {
        const result = await this.executeChat({
          model: candidateModel,
          messages,
          stream,
          onToken: wrappedOnToken,
          signal,
          responseFormat,
          tools,
        });

        return {
          ...result,
          model: candidateModel,
          provider: this.name,
        };
      } catch (err) {
        lastError = err;

        // If tokens have already been streamed to client, cannot switch model mid-flight
        if (tokensEmitted) {
          throw err;
        }

        // If request was explicitly aborted, stop
        if (signal?.aborted || err.name === "AbortError") {
          throw err;
        }

        // If auth failed, other models on the same key will fail too
        const status = Number(err.status || err.statusCode || 0);
        if (status === 401) {
          throw err;
        }

        const hasMore = i < candidates.length - 1;
        if (hasMore) {
          console.warn(
            `[${this.name}] Model "${candidateModel}" failed (${err.message || status}). Falling back to next model "${candidates[i + 1]}" (${i + 2}/${candidates.length})...`
          );
        }
      }
    }

    throw lastError || new AppError(
      `All models in pool exhausted for provider "${this.name}".`,
      503,
      "ALL_MODELS_UNAVAILABLE"
    );
  }

  /**
   * Subclasses must implement executeChat({ model, messages, stream, onToken, signal, responseFormat, tools })
   */
  async executeChat(params) {
    throw new Error(`executeChat() not implemented on provider "${this.name}".`);
  }
}
