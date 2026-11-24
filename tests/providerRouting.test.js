import test from "node:test";
import assert from "node:assert/strict";
import providerRegistry from "../services/providers/providerRegistry.js";
import { generateAnswer } from "../services/answer.service.js";

test("providerRegistry: resolves provider based on explicit provider hint", () => {
  const geminiRes = providerRegistry.resolveProviderForModel("gemini-3.8-flash", "Gemini");
  assert.equal(geminiRes.provider.name, "gemini");
  assert.equal(geminiRes.model, "gemini-3.8-flash");

  const groqRes = providerRegistry.resolveProviderForModel("openai/gpt-oss-120b", "Groq");
  assert.equal(groqRes.provider.name, "groq");
  assert.equal(groqRes.model, "openai/gpt-oss-120b");

  const openrouterRes = providerRegistry.resolveProviderForModel("openai/gpt-4o-mini", "OpenRouter");
  assert.equal(openrouterRes.provider.name, "openrouter");
  assert.equal(openrouterRes.model, "openai/gpt-4o-mini");
});

test("providerRegistry: falls back to model prefix when provider hint is omitted", () => {
  const groqRes = providerRegistry.resolveProviderForModel("groq/llama-3.3-70b-versatile");
  assert.equal(groqRes.provider.name, "groq");
  assert.equal(groqRes.model, "llama-3.3-70b-versatile");

  const geminiRes = providerRegistry.resolveProviderForModel("gemini-2.0-flash");
  assert.equal(geminiRes.provider.name, "gemini");
  assert.equal(geminiRes.model, "gemini-2.0-flash");
});

test("generateAnswer: directly calls Gemini provider when provider is Gemini", async () => {
  let geminiCalled = false;
  let receivedModel = null;

  const originalChat = providerRegistry.gemini.chat;
  const originalIsConfigured = providerRegistry.gemini.isConfigured;

  providerRegistry.gemini.isConfigured = () => true;
  providerRegistry.gemini.chat = async ({ model }) => {
    geminiCalled = true;
    receivedModel = model;
    return {
      raw: JSON.stringify({
        title: "Gemini Answer",
        answer: "Direct response from Gemini provider",
      }),
      usage: { totalTokens: 12 },
    };
  };

  try {
    const result = await generateAnswer({
      model: "gemini-3.8-flash",
      provider: "Gemini",
      messages: [{ role: "user", content: "hello gemini" }],
    });

    assert.equal(geminiCalled, true);
    assert.equal(receivedModel, "gemini-3.8-flash");
    assert.equal(result.provider, "gemini");
    assert.equal(result.title, "Gemini Answer");
    assert.equal(result.result, "Direct response from Gemini provider");
  } finally {
    providerRegistry.gemini.chat = originalChat;
    providerRegistry.gemini.isConfigured = originalIsConfigured;
  }
});
