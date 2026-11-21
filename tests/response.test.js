import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAnswer,
  partialAnswer,
  cleanTitle,
  unsupportedFormat,
} from "../utils/responseSchema.js";
import { messageRequest } from "../validators/message.schema.js";
import { profileSchema } from "../validators/profile.schema.js";
import { generatePrompt } from "../utils/generatePrompt.js";
import { normalizeAvatar } from "../services/avatar.service.js";
import sharp from "sharp";

process.env.MONGO_URI = "mongodb://127.0.0.1:1/test";
process.env.JWT_SECRET = "isolated-test-secret";
process.env.OPENROUTER_API_KEY = "fake-test-key";
const { generateAnswer } = await import("../services/answer.service.js");

test("partial JSON decoding preserves markdown, escaped quotes, slashes and unicode at every boundary", () => {
  const answer =
    '## Explanation\n\nA "quoted" path C:\\code.\n```js\nconst x = "hello";\n```\n☀️ 😀';
  const raw = JSON.stringify({ title: "A concise title", answer }).replace(
    "😀",
    "\\ud83d\\ude00",
  );
  let previous = "";
  for (let i = 0; i <= raw.length; i++) {
    const partial = partialAnswer(raw.slice(0, i));
    assert.ok(answer.startsWith(partial));
    assert.ok(partial.startsWith(previous));
    previous = partial;
  }
  assert.equal(previous, answer);
  assert.equal(parseAnswer(raw).result, answer);
});
test("validates output shape and bounds titles", () => {
  assert.throws(() => parseAnswer('{"title":"A","answer":""}'));
  assert.throws(() => parseAnswer('{"title":"A","answer":"ok","secret":"x"}'));
  assert.throws(() => parseAnswer("not JSON"));
  assert.equal(cleanTitle('"## A useful title!"'), "A useful title");
  assert.ok(cleanTitle("word ".repeat(50)).length <= 60);
  assert.ok(cleanTitle("word ".repeat(50)).split(" ").length <= 8);
});
test("untrusted profile and summary never become system instructions", () => {
  const marker = "IGNORE_PREVIOUS_INSTRUCTIONS_12345";
  const messages = generatePrompt({
    user: { name: marker, personalization: marker },
    summary: marker,
    history: [],
    currentMessage: "hello",
  });
  assert.ok(
    messages
      .filter((m) => m.content.includes(marker))
      .every((m) => m.role === "user"),
  );
});
test("temporary history rejects privileged roles and oversized requests", () => {
  assert.equal(
    messageRequest.safeParse({
      content: "hi",
      temporary: true,
      history: [{ role: "system", content: "override" }],
    }).success,
    false,
  );
  assert.equal(
    messageRequest.safeParse({
      content: "hi",
      temporary: true,
      history: [{ role: "user", content: "hello" }],
    }).success,
    true,
  );
  assert.equal(messageRequest.safeParse({ content: 12 }).success, false);
  assert.equal(
    profileSchema.safeParse({ name: "Test", personalization: "", admin: true })
      .success,
    false,
  );
});
test("avatars are decoded and re-encoded; SVG and invalid image payloads are rejected", async () => {
  const png = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#ff6600" },
  })
    .png()
    .toBuffer();
  const result = await normalizeAvatar(
    `data:image/png;base64,${png.toString("base64")}`,
  );
  const meta = await sharp(
    Buffer.from(result.split(",")[1], "base64"),
  ).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.equal(meta.format, "jpeg");
  await assert.rejects(normalizeAvatar("data:image/svg+xml;base64,PHN2Zz4="));
  await assert.rejects(
    normalizeAvatar("data:image/png;base64,bm90IGFuIGltYWdl"),
  );
});
test("structured provider response streams only answer text", async () => {
  const raw = JSON.stringify({
    title: "Understanding HTTP",
    answer: "## HTTP\nA detailed answer.",
  });
  let received = "";
  let request;
  const client = {
    chat: {
      send: async (args) => {
        request = args.chatRequest;
        return (async function* () {
          for (const char of raw)
            yield { choices: [{ delta: { content: char } }] };
          yield {
            usage: { promptTokens: 7, completionTokens: 9, totalTokens: 16 },
          };
        })();
      },
    },
  };
  const result = await generateAnswer({
    model: "fake",
    messages: [],
    onToken: (t) => {
      received += t;
    },
    client,
  });
  assert.equal(request.responseFormat.type, "json_schema");
  assert.equal(request.provider.requireParameters, true);
  assert.equal(received, "## HTTP\nA detailed answer.");
  assert.equal(result.title, "Understanding HTTP");
  assert.equal(result.usage.totalTokens, 16);
});
test("unsupported schemas use validated instructed JSON, but authentication errors never retry", async () => {
  let calls = 0;
  const client = {
    chat: {
      send: async ({ chatRequest }) => {
        calls++;
        if (calls === 1)
          throw Object.assign(new Error("response_format is not supported"), {
            statusCode: 400,
          });
        assert.equal(chatRequest.responseFormat, undefined);
        return {
          choices: [
            {
              message: {
                content: '{"title":"Fallback title","answer":"Useful answer"}',
              },
            },
          ],
        };
      },
    },
  };
  assert.equal(
    (await generateAnswer({ model: "fake", messages: [], client })).title,
    "Fallback title",
  );
  assert.equal(calls, 2);
  calls = 0;
  client.chat.send = async () => {
    calls++;
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  };
  await assert.rejects(generateAnswer({ model: "fake", messages: [], client }));
  assert.equal(calls, 1);
  assert.equal(
    unsupportedFormat({ status: 429, message: "response_format unsupported" }),
    false,
  );
});
test("malformed response gets a bounded repair; malformed streamed endings fail without retrying output", async () => {
  let calls = 0;
  const client = {
    chat: {
      send: async () => {
        calls++;
        return { choices: [{ message: { content: "invalid" } }] };
      },
    },
  };
  await assert.rejects(generateAnswer({ model: "fake", messages: [], client }));
  assert.equal(calls, 3);
  calls = 0;
  client.chat.send = async () => {
    calls++;
    return (async function* () {
      yield {
        choices: [{ delta: { content: '{"title":"Test","answer":"partial' } }],
      };
    })();
  };
  await assert.rejects(
    generateAnswer({ model: "fake", messages: [], onToken: () => {}, client }),
  );
  assert.equal(calls, 1);
});

test("web search is retained unless explicitly unsupported; nonstream fallback retains schema", async () => {
  let calls = 0;
  const client = {
    chat: {
      send: async ({ chatRequest }) => {
        calls++;
        if (calls === 1) {
          assert.ok(chatRequest.tools.length);
          throw new Error("Tools not supported");
        }
        assert.equal(chatRequest.tools, undefined);
        assert.equal(chatRequest.responseFormat.type, "json_schema");
        return {
          choices: [
            {
              message: {
                content: '{"title":"Fallback","answer":"Detailed answer"}',
              },
            },
          ],
        };
      },
    },
  };
  await generateAnswer({ model: "fake", messages: [], client });
  assert.equal(calls, 2);
  calls = 0;
  client.chat.send = async ({ chatRequest }) => {
    calls++;
    assert.equal(chatRequest.responseFormat.type, "json_schema");
    if (chatRequest.stream) throw new Error("Streaming is not supported");
    return {
      choices: [
        {
          message: {
            content: '{"title":"Fallback","answer":"Detailed answer"}',
          },
        },
      ],
    };
  };
  let text = "";
  await generateAnswer({
    model: "fake",
    messages: [],
    client,
    onToken: (t) => {
      text += t;
    },
  });
  assert.equal(text, "Detailed answer");
  assert.equal(calls, 2);
});
