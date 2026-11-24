import test from "node:test";
import assert from "node:assert/strict";
import { FreeRouterService } from "../services/freeRouter.service.js";
import { BaseProvider } from "../services/providers/base.provider.js";
import { KeyPool } from "../services/keyPool.service.js";

test("FreeRouter: picks next provider in weighted round-robin sequence", () => {
  const router = new FreeRouterService();
  const p1 = new BaseProvider({ name: "prov1", weight: 2, defaultFreeModel: "m1" });
  const p2 = new BaseProvider({ name: "prov2", weight: 1, defaultFreeModel: "m2" });

  const providers = [p1, p2];
  const sequence = [];
  for (let i = 0; i < 6; i++) {
    const picked = router.pickNextProvider(providers);
    sequence.push(picked.name);
  }

  // Over 6 requests with weights 2:1, prov1 gets 4, prov2 gets 2
  const counts = sequence.reduce((acc, name) => {
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});

  assert.equal(counts.prov1, 4);
  assert.equal(counts.prov2, 2);
});

test("FreeRouter: cancels slow provider and seamlessly fails over to next provider", async () => {
  const router = new FreeRouterService({ timeoutMs: 50 });

  // Slow provider that hangs past timeout
  const slowProvider = new BaseProvider({
    name: "slow-prov",
    keyPool: new KeyPool({ providerName: "slow", keys: ["k1"] }),
    defaultFreeModel: "slow-model",
    weight: 10, // picked first
  });
  slowProvider.chat = async ({ signal }) => {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        resolve({
          raw: JSON.stringify({ title: "Slow Title", answer: "Slow Answer" }),
          usage: {},
        });
      }, 500);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("Request aborted by timeout"));
      });
    });
  };

  // Fast provider that responds immediately
  const fastProvider = new BaseProvider({
    name: "fast-prov",
    keyPool: new KeyPool({ providerName: "fast", keys: ["k2"] }),
    defaultFreeModel: "fast-model",
    weight: 1,
  });
  fastProvider.chat = async () => {
    return {
      raw: JSON.stringify({
        title: "Fast Title",
        answer: "Fast Response Succeeded",
      }),
      usage: { totalTokens: 15 },
    };
  };

  // Override available providers for testing
  const origAvailable = (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders;
  (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders = () => [
    slowProvider,
    fastProvider,
  ];

  try {
    const result = await router.generateFreeAnswer({
      messages: [{ role: "user", content: "hello" }],
      timeoutMs: 50,
    });

    assert.equal(result.provider, "fast-prov");
    assert.equal(result.title, "Fast Title");
    assert.equal(result.result, "Fast Response Succeeded");
  } finally {
    (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders = origAvailable;
  }
});

test("FreeRouter: skips provider with rate-limit error and fails over seamlessly", async () => {
  const router = new FreeRouterService();

  const rateLimitedProvider = new BaseProvider({
    name: "rl-prov",
    keyPool: new KeyPool({ providerName: "rl", keys: ["k1"] }),
    defaultFreeModel: "rl-model",
    weight: 10,
  });
  rateLimitedProvider.chat = async () => {
    const err = new Error("Rate limit exceeded 429");
    err.status = 429;
    throw err;
  };

  const backupProvider = new BaseProvider({
    name: "backup-prov",
    keyPool: new KeyPool({ providerName: "backup", keys: ["k2"] }),
    defaultFreeModel: "backup-model",
    weight: 1,
  });
  backupProvider.chat = async () => {
    return {
      raw: JSON.stringify({
        title: "Backup Title",
        answer: "Backup Answer Delivered",
      }),
      usage: { totalTokens: 20 },
    };
  };

  const origAvailable = (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders;
  (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders = () => [
    rateLimitedProvider,
    backupProvider,
  ];

  try {
    const result = await router.generateFreeAnswer({
      messages: [{ role: "user", content: "hi" }],
    });

    assert.equal(result.provider, "backup-prov");
    assert.equal(result.result, "Backup Answer Delivered");
  } finally {
    (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders = origAvailable;
  }
});

test("FreeRouter: when only one provider has the free feature, all requests route to that provider with extended timeout", async () => {
  const router = new FreeRouterService({
    timeoutMs: 50,
    singleProviderTimeoutMs: 200,
  });

  let calledWithModel = null;
  const singleProvider = new BaseProvider({
    name: "openrouter",
    keyPool: new KeyPool({ providerName: "openrouter", keys: ["k1", "k2"] }),
    defaultFreeModel: "openrouter/free",
  });
  // Simulate provider taking 100ms (more than failover timeout 50ms, but within extended single timeout 200ms)
  singleProvider.chat = async ({ model }) => {
    calledWithModel = model;
    await new Promise((r) => setTimeout(r, 100));
    return {
      raw: JSON.stringify({
        title: "Single Provider Title",
        answer: "Single Provider Answer",
      }),
      usage: { totalTokens: 10 },
    };
  };

  const origAvailable = (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders;
  // Simulate only one provider having the free model feature
  (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders = () => [
    singleProvider,
  ];

  try {
    const result = await router.generateFreeAnswer({
      messages: [{ role: "user", content: "test single provider" }],
    });

    assert.equal(result.provider, "openrouter");
    assert.equal(calledWithModel, "openrouter/free");
    assert.equal(result.title, "Single Provider Title");
    assert.equal(result.result, "Single Provider Answer");
  } finally {
    (await import("../services/providers/providerRegistry.js")).default.getAvailableFreeProviders = origAvailable;
  }
});
