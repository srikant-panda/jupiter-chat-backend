import test from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../middlewares/error.middleware.js";
import { AppError } from "../utils/appError.js";
import { z } from "zod";

function mockRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: null,
    written: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    write(chunk) {
      this.written.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
  };
  return res;
}

test("errorHandler: formats standard operational AppError as JSON", () => {
  const res = mockRes();
  const err = new AppError("Invalid chat target", 400, "BAD_TARGET");

  errorHandler(err, { method: "POST", originalUrl: "/api/chat" }, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Invalid chat target");
  assert.equal(res.body.errorCode, "BAD_TARGET");
});

test("errorHandler: formats ZodError with clean field paths", () => {
  const res = mockRes();
  const schema = z.object({ age: z.number().min(18) });
  const result = schema.safeParse({ age: 10 });
  assert.equal(result.success, false);

  errorHandler(result.error, { method: "POST", originalUrl: "/api/user" }, res, () => {});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.ok(res.body.message.includes("age"));
});

test("errorHandler: handles active SSE stream with SSE error event without crashing", () => {
  const res = mockRes();
  res.headersSent = true;
  const err = new AppError("Stream interrupted", 502, "STREAM_FAIL");

  errorHandler(err, { method: "POST", originalUrl: "/api/message/stream" }, res, () => {});

  assert.equal(res.writableEnded, true);
  assert.ok(res.written.some((w) => w.includes("event: error")));
  assert.ok(res.written.some((w) => w.includes("Stream interrupted")));
});
