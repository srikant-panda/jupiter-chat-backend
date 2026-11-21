import { z } from "zod";
import { renderD2Diagram, validateD2Code } from "../services/d2.service.js";

const renderSchema = z.object({
  code: z.string().min(1, "Code is required").max(50000, "Diagram code is too large"),
  layout: z.enum(["dagre", "elk", "tala"]).optional().default("dagre"),
  theme: z.union([z.string(), z.number()]).optional().default("dark"),
  direction: z.enum(["down", "right", "up", "left"]).optional().nullable(),
  sketch: z.boolean().optional().default(false),
});

const validateSchema = z.object({
  code: z.string().min(1, "Code is required").max(50000, "Diagram code is too large"),
});

export async function handleRenderDiagram(req, res) {
  try {
    const parseResult = renderSchema.safeParse(req.body);
    if (!parseResult.success) {
      const issue = parseResult.error.issues[0];
      return res.status(400).json({
        success: false,
        error: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid request data",
      });
    }

    const { code, layout, theme, direction, sketch } = parseResult.data;

    const result = await renderD2Diagram({
      code,
      layout,
      theme,
      direction,
      sketch,
    });

    return res.json({
      success: true,
      svg: result.svg,
      cached: result.cached,
      layout: result.layout,
      themeID: result.themeID,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message || "Failed to render diagram",
      details: err.details || null,
    });
  }
}

export async function handleValidateDiagram(req, res) {
  try {
    const parseResult = validateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        valid: false,
        error: "Code is required and must not exceed 50,000 characters",
      });
    }

    const { code } = parseResult.data;
    const result = await validateD2Code(code);

    if (result.valid) {
      return res.json({ valid: true });
    }

    return res.status(400).json({
      valid: false,
      error: result.error,
      details: result.details,
    });
  } catch (err) {
    return res.status(500).json({
      valid: false,
      error: err.message || "Internal validation error",
    });
  }
}
