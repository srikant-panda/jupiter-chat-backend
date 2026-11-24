import { AppError } from "../utils/appError.js";
import { devLog, devWarn, extractCleanLLMError } from "../utils/logger.js";

/**
 * Checks whether an error is caused by rate limiting or quota exhaustion.
 */
export function isRateLimitError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode || err.response?.status || 0);
  if (status === 429) return true;
  if (status === 402 || status === 403) {
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("quota") || msg.includes("credit") || msg.includes("exhausted") || msg.includes("rate limit")) {
      return true;
    }
  }
  const rawMsg = (
    err.message ||
    err.error?.message ||
    err.response?.data?.error?.message ||
    (typeof err.error === "string" ? err.error : "") ||
    ""
  ).toLowerCase();

  return (
    rawMsg.includes("rate limit") ||
    rawMsg.includes("too many requests") ||
    rawMsg.includes("quota exceeded") ||
    rawMsg.includes("insufficient_quota") ||
    rawMsg.includes("resource_exhausted") ||
    rawMsg.includes("credits exhausted") ||
    rawMsg.includes("out of credits")
  );
}

/**
 * KeyPool manages multiple API keys for an upstream provider:
 * - Parses comma-separated key lists
 * - Rotates keys evenly using Smooth Weighted Round-Robin (SWRR)
 * - Temporarily blacklists rate-limited keys for a cooldown duration (default 4 hours)
 * - Automatically un-blacklists keys once cooldown expires
 * - In-pool automatic retries before giving up on a provider
 */
export class KeyPool {
  constructor({
    providerName = "unknown",
    keys = [],
    defaultWeight = 1,
    cooldownHours = 4,
  } = {}) {
    this.providerName = providerName;
    this.defaultCooldownHours = Number(cooldownHours) || 4;
    this.keys = [];
    this.initKeys(keys, defaultWeight);
  }

  /**
   * Initializes or updates key list from array or comma-separated string.
   */
  initKeys(rawKeys, weight = 1) {
    let keyStrings = [];
    if (typeof rawKeys === "string") {
      keyStrings = rawKeys
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
    } else if (Array.isArray(rawKeys)) {
      keyStrings = rawKeys
        .map((k) => (typeof k === "string" ? k.trim() : ""))
        .filter(Boolean);
    }

    // Deduplicate keys
    const uniqueKeys = Array.from(new Set(keyStrings));

    this.keys = uniqueKeys.map((key) => ({
      key,
      weight: Math.max(1, Number(weight) || 1),
      currentWeight: 0,
      blacklistedUntil: null,
      blacklistReason: null,
      failureCount: 0,
      totalRequests: 0,
    }));
  }

  /**
   * Returns count of configured keys.
   */
  get totalKeys() {
    return this.keys.length;
  }

  /**
   * Checks if a key item is currently available (not in active cooldown).
   */
  isKeyAvailable(item, now = Date.now()) {
    if (!item.blacklistedUntil) return true;
    if (now >= item.blacklistedUntil) {
      devLog(
        `[KeyPool:${this.providerName}] Cooldown expired for key ...${item.key.slice(-4)}. Restoring to active pool.`
      );
      item.blacklistedUntil = null;
      item.blacklistReason = null;
      item.failureCount = 0;
      return true;
    }
    return false;
  }

  /**
   * Returns all active, non-blacklisted keys.
   */
  getAvailableKeys(now = Date.now()) {
    return this.keys.filter((item) => this.isKeyAvailable(item, now));
  }

  /**
   * Whether at least one key is ready for requests.
   */
  hasAvailableKey(now = Date.now()) {
    return this.getAvailableKeys(now).length > 0;
  }

  /**
   * Acquires the next available key using Smooth Weighted Round-Robin (SWRR).
   */
  acquireKey() {
    const now = Date.now();
    const available = this.getAvailableKeys(now);

    if (available.length === 0) {
      const nearestCooldown = this.keys
        .map((k) => k.blacklistedUntil)
        .filter(Boolean)
        .sort((a, b) => a - b)[0];

      const remainingSec = nearestCooldown
        ? Math.max(1, Math.ceil((nearestCooldown - now) / 1000))
        : 0;

      throw new AppError(
        `All API keys for provider "${this.providerName}" are temporarily blacklisted due to rate limits. Next key available in ~${Math.ceil(
          remainingSec / 60
        )} minutes.`,
        429,
        "PROVIDER_KEYS_EXHAUSTED",
        { provider: this.providerName, remainingSec }
      );
    }

    // Single key optimization
    if (available.length === 1) {
      return available[0].key;
    }

    // Smooth Weighted Round-Robin (SWRR)
    let totalWeight = 0;
    let selected = null;

    for (const item of available) {
      item.currentWeight += item.weight;
      totalWeight += item.weight;
      if (!selected || item.currentWeight > selected.currentWeight) {
        selected = item;
      }
    }

    if (selected) {
      selected.currentWeight -= totalWeight;
      return selected.key;
    }

    return available[0].key;
  }

  /**
   * Reports a rate limit or quota error on a key, triggering temporary blacklisting.
   */
  reportRateLimit(key, error, customDurationHours = null) {
    const item = this.keys.find((k) => k.key === key);
    if (!item) return;

    const hours = customDurationHours || this.defaultCooldownHours;
    const cooldownMs = hours * 3600 * 1000;
    const until = Date.now() + cooldownMs;

    item.blacklistedUntil = until;
    const cleanReason = extractCleanLLMError(error) || "Rate limit / quota exceeded";
    item.blacklistReason = cleanReason;
    item.failureCount += 1;

    devWarn(
      `[KeyPool:${this.providerName}] Key ...${key.slice(-4)} blacklisted for ${hours}h until ${new Date(
        until
      ).toISOString()} due to rate limit: ${cleanReason}`
    );
  }

  /**
   * Reports a successful request with a key.
   */
  reportSuccess(key) {
    const item = this.keys.find((k) => k.key === key);
    if (!item) return;
    item.failureCount = 0;
    item.totalRequests += 1;
  }

  /**
   * Executes an async operation with automatic key acquisition and retry on 429.
   */
  async executeWithRetry(operation, { maxRetries = null } = {}) {
    const maxAttempts = maxRetries !== null ? maxRetries : Math.max(1, this.keys.length);
    let attempts = 0;
    let lastError = null;

    while (attempts < maxAttempts) {
      const available = this.getAvailableKeys();
      if (available.length === 0) {
        break;
      }

      const key = this.acquireKey();
      attempts += 1;

      try {
        const result = await operation(key);
        this.reportSuccess(key);
        return result;
      } catch (err) {
        lastError = err;
        if (isRateLimitError(err)) {
          this.reportRateLimit(key, err);
          // If there are other keys still available in this pool, try the next key immediately
          if (this.hasAvailableKey()) {
            devWarn(
              `[KeyPool:${this.providerName}] Key hit rate limit, retrying immediately with another available key (attempt ${attempts}/${maxAttempts})...`
            );
            continue;
          }
        }
        throw err;
      }
    }

    if (lastError) throw lastError;
    throw new AppError(
      `No available keys to execute request on provider "${this.providerName}".`,
      429,
      "PROVIDER_UNAVAILABLE"
    );
  }

  /**
   * Provides current pool diagnostic status.
   */
  getStatus() {
    const now = Date.now();
    return {
      provider: this.providerName,
      totalKeys: this.keys.length,
      availableKeys: this.getAvailableKeys(now).length,
      blacklistedKeys: this.keys.filter((k) => !this.isKeyAvailable(k, now)).map((k) => ({
        keyMasked: `...${k.key.slice(-4)}`,
        remainingMinutes: Math.max(0, Math.ceil((k.blacklistedUntil - now) / 60000)),
        reason: k.blacklistReason,
      })),
    };
  }
}
