/**
 * Utility for environment-aware logging and clean error extraction.
 * Errors and diagnostic warnings are only output in development mode (or test mode),
 * keeping production (main branch) output clean, silent, and secure.
 */

export function isDevMode() {
  return Boolean(
    process.env.NODE_ENV === "development" ||
    process.env.DEV_MODE === "true" ||
    process.env.DEV === "true" ||
    process.env.TEST_MODE === "true"
  );
}

/**
 * Extracts a concise, human-readable one-line summary from raw LLM or API errors.
 * Recursively parses nested JSON strings (e.g. Google GenAI / RPC / OpenRouter / Groq error payloads),
 * stripping verbose multi-line stacks, metric lists, and raw JSON blobs.
 *
 * @param {any} err - The error instance, string, or object.
 * @returns {string} - Clean, concise headline (max ~200 chars).
 */
export function extractCleanLLMError(err) {
  if (!err) return "Unknown error";

  let raw = typeof err === "string" ? err : err.message || err.error || "";
  if (typeof raw !== "string") {
    try {
      raw = JSON.stringify(raw);
    } catch {
      raw = String(raw);
    }
  }

  let clean = raw.trim();
  if (clean.startsWith("Response failed:")) {
    clean = clean.replace(/^Response failed:\s*/, "");
  }

  let obj = null;
  let currStr = clean;

  // Unpack nested JSON strings up to 3 levels deep
  for (let i = 0; i < 3; i++) {
    if (typeof currStr === "string" && (currStr.startsWith("{") || currStr.startsWith("["))) {
      try {
        const parsed = JSON.parse(currStr);
        obj = parsed;
        if (
          typeof parsed?.error?.message === "string" &&
          (parsed.error.message.startsWith("{") || parsed.error.message.startsWith("["))
        ) {
          currStr = parsed.error.message;
        } else if (
          typeof parsed?.message === "string" &&
          (parsed.message.startsWith("{") || parsed.message.startsWith("["))
        ) {
          currStr = parsed.message;
        } else {
          break;
        }
      } catch {
        break;
      }
    } else {
      break;
    }
  }

  if (obj && typeof obj === "object") {
    let curr = obj;
    while (curr && typeof curr === "object") {
      if (curr.error && typeof curr.error === "object") {
        curr = curr.error;
      } else if (curr.response && typeof curr.response === "object") {
        curr = curr.response;
      } else {
        break;
      }
    }

    let msg = curr?.message || obj.message || "";
    if (typeof msg === "string" && (msg.startsWith("{") || msg.startsWith("["))) {
      try {
        const nested = JSON.parse(msg);
        if (nested.error?.message) {
          msg = nested.error.message;
          if (nested.error.code && !curr.code) curr.code = nested.error.code;
          if (nested.error.status && !curr.status) curr.status = nested.error.status;
        } else if (nested.message) {
          msg = nested.message;
        }
      } catch {}
    }

    const code = curr?.code || obj.code || (err.status || err.statusCode || "");
    const status = curr?.status || obj.status || "";

    if (typeof msg === "string" && msg.trim()) {
      // Split on newline or documentation references
      let headline = msg.split(/\n|\. For more information|\. See https:/)[0].trim();
      if (!headline.endsWith(".")) headline += ".";

      // Extract retry delay if available
      const retryMatch = msg.match(/Please (?:retry|try again) in ([^;\n]+?)(?:\.\s|\.$|$)/i);
      const retryTime = retryMatch ? retryMatch[1].replace(/\.\d+s/, "s").trim() : "";
      const retryText = retryTime ? ` Retry in ${retryTime}.` : "";

      const prefix = [code, status].filter(Boolean).join(" ");
      const finalMsg = `${prefix ? `[${prefix}] ` : ""}${headline}${retryText}`.trim();
      return finalMsg.length > 200 ? finalMsg.slice(0, 197) + "..." : finalMsg;
    }

    if (code || status) {
      return `Error [${[code, status].filter(Boolean).join(" ")}]`;
    }
  }

  const line = clean.split("\n")[0].trim();
  return line.length > 200 ? line.slice(0, 197) + "..." : line;
}

/**
 * Logs info to console only in development mode.
 */
export function devLog(...args) {
  if (isDevMode()) {
    console.log(...args);
  }
}

/**
 * Logs warning to console only in development mode.
 */
export function devWarn(...args) {
  if (isDevMode()) {
    console.warn(...args);
  }
}

/**
 * Logs error to console only in development mode.
 */
export function devError(...args) {
  if (isDevMode()) {
    console.error(...args);
  }
}
