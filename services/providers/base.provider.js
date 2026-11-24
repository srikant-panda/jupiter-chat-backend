/**
 * BaseProvider defines the common contract for all AI model providers.
 */
export class BaseProvider {
  constructor({ name, keyPool, defaultFreeModel = null, weight = 1 }) {
    this.name = name;
    this.keyPool = keyPool;
    this.defaultFreeModel = defaultFreeModel;
    this.weight = Math.max(1, Number(weight) || 1);
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
    return Boolean(this.isAvailable() && this.defaultFreeModel);
  }

  /**
   * Returns the model name used for free tier queries.
   */
  getFreeModel() {
    return this.defaultFreeModel;
  }

  /**
   * Execute chat completion. Subclasses must implement.
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
    throw new Error(`chat() not implemented on provider "${this.name}".`);
  }
}
