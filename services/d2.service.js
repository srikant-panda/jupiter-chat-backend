import crypto from "crypto";

let d2Instance = null;
let d2InitPromise = null;

// In-memory LRU cache for rendered diagram SVGs
const svgCache = new Map();
const MAX_CACHE_SIZE = 500;

function getCacheKey(code, layout, theme, direction, sketch) {
  const hash = crypto
    .createHash("sha256")
    .update(`${code}|${layout}|${theme}|${direction}|${Boolean(sketch)}`)
    .digest("hex");
  return hash;
}

function cacheSvg(key, svg) {
  if (svgCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = svgCache.keys().next().value;
    svgCache.delete(oldestKey);
  }
  svgCache.set(key, svg);
}

/**
 * Initializes and returns the shared D2 WASM instance.
 */
export async function getD2Instance() {
  if (d2Instance) return d2Instance;
  if (!d2InitPromise) {
    d2InitPromise = (async () => {
      const { D2 } = await import("@d2lang/d2");
      d2Instance = new D2();
      return d2Instance;
    })();
  }
  return d2InitPromise;
}

/**
 * Clean and prepare D2 source code
 */
export function cleanD2Code(raw) {
  if (!raw || typeof raw !== "string") return "";
  let text = raw.trim();

  // Strip markdown code fences if present (```d2, ```d2lang, ```diagram, etc.)
  text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  return text;
}

/**
 * Apply direction override if requested
 */
export function applyDirection(code, direction) {
  if (!direction) return code;
  const dir = direction.toLowerCase().trim();
  if (dir !== "right" && dir !== "down" && dir !== "up" && dir !== "left") {
    return code;
  }

  // If code already defines top-level direction, replace it; otherwise prepend it
  if (/^\s*direction\s*:\s*[a-zA-Z]+/m.test(code)) {
    return code.replace(/^\s*direction\s*:\s*[a-zA-Z]+/m, `direction: ${dir}`);
  }
  return `direction: ${dir}\n${code}`;
}

/**
 * Parse D2 compiler errors into user-friendly message and line details
 */
export function parseD2Error(err) {
  const rawMsg = err?.message || String(err || "D2 compilation failed");

  try {
    const parsed = JSON.parse(rawMsg);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const formattedErrors = parsed.map((item) => {
        let line = null;
        let column = null;
        let file = "index";
        let message = item.errmsg || "Syntax error";

        // item.errmsg often looks like: "index:2:5: unexpected token"
        const lineMatch = message.match(/([^:]+):(\d+):(\d+):\s*(.*)/);
        if (lineMatch) {
          file = lineMatch[1];
          line = parseInt(lineMatch[2], 10);
          column = parseInt(lineMatch[3], 10);
          message = lineMatch[4] || message;
        }

        return { file, line, column, message, raw: item.errmsg };
      });

      const first = formattedErrors[0];
      const friendlyMessage = first.line
        ? `Line ${first.line}${first.column ? `:${first.column}` : ""}: ${first.message}`
        : first.message;

      return {
        friendlyMessage,
        errors: formattedErrors,
      };
    }
  } catch {
    // Not JSON; parse plain text error
  }

  return {
    friendlyMessage: rawMsg.replace(/^Error:\s*/i, ""),
    errors: [{ message: rawMsg }],
  };
}

/**
 * Sanitize rendered SVG to ensure safe embedding
 */
export function sanitizeSvg(svg) {
  if (!svg || typeof svg !== "string") return "";

  let cleaned = svg;

  // Remove XML preamble <?xml ...?>
  cleaned = cleaned.replace(/^<\?xml[^>]*\?>\s*/i, "");

  // Remove <script> elements and their content
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Remove on* inline event handler attributes
  cleaned = cleaned.replace(/\s+on[a-zA-Z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Remove javascript: URLs
  cleaned = cleaned.replace(/(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=""');

  return cleaned.trim();
}

/**
 * Render D2 diagram to sanitized SVG
 */
export async function renderD2Diagram({
  code,
  layout = "dagre",
  theme = "dark",
  direction = null,
  sketch = false,
}) {
  const cleanedCode = cleanD2Code(code);
  if (!cleanedCode) {
    throw new Error("D2 code cannot be empty");
  }

  const finalCode = applyDirection(cleanedCode, direction);

  // Map theme name to numeric D2 themeID
  let themeID = 100; // default dark terminal
  if (typeof theme === "number") {
    themeID = theme;
  } else if (typeof theme === "string") {
    const t = theme.toLowerCase().trim();
    if (t === "light") {
      themeID = 0; // neutral light
    } else if (t === "dark") {
      themeID = 100; // terminal dark
    } else if (t === "mauve") {
      themeID = 102;
    } else if (t === "dim") {
      themeID = 103;
    } else if (t === "buttercream") {
      themeID = 200;
    } else if (t === "glass") {
      themeID = 300;
    } else {
      const parsedNum = parseInt(t, 10);
      if (!Number.isNaN(parsedNum)) {
        themeID = parsedNum;
      }
    }
  }

  // Validate layout engine
  const validLayouts = ["dagre", "elk", "tala"];
  const chosenLayout = validLayouts.includes(layout?.toLowerCase())
    ? layout.toLowerCase()
    : "dagre";

  // Check cache
  const cacheKey = getCacheKey(finalCode, chosenLayout, themeID, direction, sketch);
  if (svgCache.has(cacheKey)) {
    return {
      svg: svgCache.get(cacheKey),
      cached: true,
      layout: chosenLayout,
      themeID,
    };
  }

  const d2 = await getD2Instance();

  try {
    const compileResult = await d2.compile(finalCode, {
      layout: chosenLayout,
      sketch: Boolean(sketch),
      themeID,
      noXMLTag: true,
    });

    const rawSvg = await d2.render(compileResult.diagram, compileResult.renderOptions);
    const sanitized = sanitizeSvg(rawSvg);

    cacheSvg(cacheKey, sanitized);

    return {
      svg: sanitized,
      cached: false,
      layout: chosenLayout,
      themeID,
    };
  } catch (err) {
    const parsed = parseD2Error(err);
    const error = new Error(parsed.friendlyMessage);
    error.details = parsed.errors;
    error.isD2Error = true;
    throw error;
  }
}

/**
 * Validate D2 syntax without rendering full SVG
 */
export async function validateD2Code(code) {
  const cleanedCode = cleanD2Code(code);
  if (!cleanedCode) {
    return { valid: false, error: "D2 code cannot be empty" };
  }

  const d2 = await getD2Instance();

  try {
    await d2.compile(cleanedCode, { layout: "dagre" });
    return { valid: true };
  } catch (err) {
    const parsed = parseD2Error(err);
    return {
      valid: false,
      error: parsed.friendlyMessage,
      details: parsed.errors,
    };
  }
}
