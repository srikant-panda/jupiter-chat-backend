import test from "node:test";
import assert from "node:assert/strict";
import { KeyPool, isRateLimitError } from "../services/keyPool.service.js";

test("KeyPool: parses comma-separated string, trims whitespace and filters duplicates", () => {
  const pool = new KeyPool({
    providerName: "test",
    keys: " key1 , key2,key3 , key1, ",
  });
  assert.equal(pool.totalKeys, 3);
  assert.deepEqual(
    pool.keys.map((k) => k.key),
    ["key1", "key2", "key3"]
  );
});

test("KeyPool: distributes requests smoothly and evenly across multiple keys", () => {
  const pool = new KeyPool({
    providerName: "test",
    keys: ["k1", "k2", "k3"],
    defaultWeight: 1,
  });

  const counts = { k1: 0, k2: 0, k3: 0 };
  const sequence = [];

  for (let i = 0; i < 9; i++) {
    const key = pool.acquireKey();
    sequence.push(key);
    counts[key] = (counts[key] || 0) + 1;
  }

  assert.equal(counts.k1, 3);
  assert.equal(counts.k2, 3);
  assert.equal(counts.k3, 3);
  // Verify cyclic even interleaving
  assert.deepEqual(sequence.slice(0, 3), ["k1", "k2", "k3"]);
  assert.deepEqual(sequence.slice(3, 6), ["k1", "k2", "k3"]);
});

test("KeyPool: blacklists rate-limited key and excludes it from selection", () => {
  const pool = new KeyPool({
    providerName: "test",
    keys: ["k1", "k2"],
    cooldownHours: 4,
  });

  assert.equal(pool.getAvailableKeys().length, 2);

  // Report 429 on k1
  pool.reportRateLimit("k1", new Error("Rate limit exceeded 429"));

  assert.equal(pool.getAvailableKeys().length, 1);
  assert.equal(pool.getAvailableKeys()[0].key, "k2");

  // Next requests must only return k2
  assert.equal(pool.acquireKey(), "k2");
  assert.equal(pool.acquireKey(), "k2");
});

test("KeyPool: automatically un-blacklists key when cooldown expires", () => {
  const pool = new KeyPool({
    providerName: "test",
    keys: ["k1"],
    cooldownHours: 1,
  });

  const now = Date.now();
  pool.reportRateLimit("k1", new Error("Rate limit"));

  // Key is currently blacklisted
  assert.equal(pool.isKeyAvailable(pool.keys[0], now), false);

  // 30 minutes later: still blacklisted
  assert.equal(pool.isKeyAvailable(pool.keys[0], now + 30 * 60 * 1000), false);

  // 61 minutes later: cooldown expired, auto restored
  assert.equal(pool.isKeyAvailable(pool.keys[0], now + 61 * 60 * 1000), true);
  assert.equal(pool.keys[0].blacklistedUntil, null);
});

test("KeyPool: executeWithRetry retries with next key when 429 is thrown", async () => {
  const pool = new KeyPool({
    providerName: "test",
    keys: ["badKey", "goodKey"],
  });

  let calls = [];
  const result = await pool.executeWithRetry(async (key) => {
    calls.push(key);
    if (key === "badKey") {
      const err = new Error("429 Too Many Requests");
      err.status = 429;
      throw err;
    }
    return `success-${key}`;
  });

  assert.equal(result, "success-goodKey");
  assert.deepEqual(calls, ["badKey", "goodKey"]);
  // badKey is now blacklisted
  assert.equal(pool.getAvailableKeys().length, 1);
  assert.equal(pool.getAvailableKeys()[0].key, "goodKey");
});

test("isRateLimitError: accurately detects 429 and quota error variants", () => {
  assert.equal(isRateLimitError({ status: 429 }), true);
  assert.equal(isRateLimitError({ statusCode: 429 }), true);
  assert.equal(isRateLimitError({ message: "Quota exceeded for model" }), true);
  assert.equal(isRateLimitError({ message: "insufficient_quota" }), true);
  assert.equal(isRateLimitError({ status: 402, message: "credits exhausted" }), true);
  assert.equal(isRateLimitError({ status: 400, message: "Invalid JSON" }), false);
});
