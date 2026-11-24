import { OpenRouterProvider } from "./openrouter.provider.js";
import { GroqProvider } from "./groq.provider.js";
import { GeminiProvider } from "./gemini.provider.js";

/**
 * ProviderRegistry holds singleton instances of all configured providers.
 */
class ProviderRegistry {
  constructor() {
    this.openrouter = new OpenRouterProvider();
    this.groq = new GroqProvider();
    this.gemini = new GeminiProvider();
  }

  /**
   * Reload / reinitialize key pools if environment changes (useful in testing).
   */
  reload() {
    this.openrouter = new OpenRouterProvider();
    this.groq = new GroqProvider();
    this.gemini = new GeminiProvider();
  }

  /**
   * Returns all providers currently eligible to serve free tier requests:
   * Must be configured, have an active free model, and have at least one key not blacklisted.
   */
  getAvailableFreeProviders() {
    const list = [];
    if (this.groq.hasFreeModel()) list.push(this.groq);
    if (this.gemini.hasFreeModel()) list.push(this.gemini);
    // OpenRouter always included if configured & has keys
    if (this.openrouter.hasFreeModel()) list.push(this.openrouter);
    return list;
  }

  /**
   * Resolves a specific model ID and optional providerHint to the responsible provider.
   */
  resolveProviderForModel(modelId = "", providerHint = "") {
    const hint = (providerHint || "").toLowerCase().trim();
    const id = (modelId || "").toLowerCase().trim();

    // 1. Explicit provider matching from database model.provider
    if (hint === "gemini" || hint === "google" || hint === "google gemini") {
      const cleanModel = modelId
        .replace(/^(gemini\/|google\/)/i, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      return { provider: this.gemini, model: cleanModel };
    }
    if (hint === "groq") {
      const cleanModel = modelId.replace(/^groq\//i, "").trim();
      return { provider: this.groq, model: cleanModel };
    }
    if (hint === "openrouter") {
      return { provider: this.openrouter, model: modelId };
    }

    // 2. Prefix or substring matching when providerHint is omitted
    if (id.startsWith("groq/")) {
      return { provider: this.groq, model: modelId.replace(/^groq\//i, "").trim() };
    }
    if (id.startsWith("gemini") || id.startsWith("google/")) {
      const cleanModel = modelId
        .replace(/^(gemini\/|google\/)/i, "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      return { provider: this.gemini, model: cleanModel };
    }

    // Default to OpenRouter for all other models
    return { provider: this.openrouter, model: modelId };
  }
}

export const providerRegistry = new ProviderRegistry();
export default providerRegistry;
