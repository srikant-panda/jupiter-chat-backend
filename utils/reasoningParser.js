/**
 * StreamReasoningFilter processes streaming chunks from any LLM provider,
 * separating reasoning/thinking tokens from final answer tokens.
 *
 * Supports:
 * 1. Dedicated provider reasoning properties (OpenRouter delta.reasoning, Groq delta.reasoning_content, Gemini part.thought)
 * 2. Inline <think>...</think> tags embedded in content streams (DeepSeek R1, Qwen, etc.)
 */
export function createStreamReasoningFilter({ onToken, onReasoning } = {}) {
  let rawContent = "";
  let rawReasoning = "";
  let inThinkTag = false;
  let tagBuffer = "";

  return {
    /**
     * Handles explicit reasoning tokens from provider SDKs
     */
    async handleReasoning(chunk) {
      if (!chunk) return;
      rawReasoning += chunk;
      if (onReasoning) {
        await onReasoning(chunk);
      }
    },

    /**
     * Handles content tokens, detecting and routing <think>...</think> blocks if present
     */
    async handleContent(chunk) {
      if (!chunk) return;

      let text = tagBuffer + chunk;
      tagBuffer = "";

      while (text.length > 0) {
        if (!inThinkTag) {
          const thinkStart = text.indexOf("<think>");
          if (thinkStart !== -1) {
            // Content before <think> is normal answer text
            const before = text.slice(0, thinkStart);
            if (before) {
              rawContent += before;
              if (onToken) await onToken(before);
            }
            inThinkTag = true;
            text = text.slice(thinkStart + 7); // skip "<think>"
          } else {
            // Check if text ends with a partial prefix of "<think>" (e.g. "<th")
            let partialMatch = false;
            for (let i = 1; i < 7 && i <= text.length; i++) {
              if ("<think>".startsWith(text.slice(-i))) {
                tagBuffer = text.slice(-i);
                const safePart = text.slice(0, -i);
                if (safePart) {
                  rawContent += safePart;
                  if (onToken) await onToken(safePart);
                }
                partialMatch = true;
                break;
              }
            }
            if (!partialMatch) {
              rawContent += text;
              if (onToken) await onToken(text);
              text = "";
            } else {
              text = "";
            }
          }
        } else {
          // Inside <think> block
          const thinkEnd = text.indexOf("</think>");
          if (thinkEnd !== -1) {
            const thought = text.slice(0, thinkEnd);
            if (thought) {
              rawReasoning += thought;
              if (onReasoning) await onReasoning(thought);
            }
            inThinkTag = false;
            text = text.slice(thinkEnd + 8); // skip "</think>"
          } else {
            // Check if text ends with a partial prefix of "</think>" (e.g. "</th")
            let partialMatch = false;
            for (let i = 1; i < 8 && i <= text.length; i++) {
              if ("</think>".startsWith(text.slice(-i))) {
                tagBuffer = text.slice(-i);
                const safePart = text.slice(0, -i);
                if (safePart) {
                  rawReasoning += safePart;
                  if (onReasoning) await onReasoning(safePart);
                }
                partialMatch = true;
                break;
              }
            }
            if (!partialMatch) {
              rawReasoning += text;
              if (onReasoning) await onReasoning(text);
              text = "";
            } else {
              text = "";
            }
          }
        }
      }
    },

    /**
     * Flushes any remaining tag buffer and returns final accumulated results
     */
    async flush() {
      if (tagBuffer) {
        if (inThinkTag) {
          rawReasoning += tagBuffer;
          if (onReasoning) await onReasoning(tagBuffer);
        } else {
          rawContent += tagBuffer;
          if (onToken) await onToken(tagBuffer);
        }
        tagBuffer = "";
      }
      return {
        raw: rawContent,
        reasoning: rawReasoning.trim(),
      };
    },

    getFinal() {
      return {
        raw: rawContent + (!inThinkTag ? tagBuffer : ""),
        reasoning: (rawReasoning + (inThinkTag ? tagBuffer : "")).trim(),
      };
    },
  };
}

/**
 * Extracts reasoning from completed (non-streaming) text containing <think>...</think>
 */
export function extractThinkReasoning(text = "") {
  if (!text || typeof text !== "string") return { content: text || "", reasoning: "" };
  const match = text.match(/<think>([\s\S]*?)<\/think>/i);
  if (match) {
    const reasoning = match[1].trim();
    const content = text.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
    return { content, reasoning };
  }
  return { content: text, reasoning: "" };
}
