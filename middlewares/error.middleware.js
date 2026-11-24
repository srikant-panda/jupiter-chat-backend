import { ZodError } from "zod";

/**
 * Centralized Express error-handling middleware.
 * Formats errors for REST clients or terminates active SSE streams gracefully.
 */
export const errorHandler = (err, req, res, next) => {
  // If headers were already sent (e.g. during SSE streaming), emit an SSE error event and end
  if (res.headersSent || res.writableEnded) {
    const errorPayload = {
      message: err.isOperational
        ? err.message
        : "An unexpected error occurred while processing your request.",
      code: err.errorCode || "STREAM_ERROR",
    };
    try {
      res.write(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`);
      res.end();
    } catch {
      // Stream already closed by client
    }
    return;
  }

  // Handle JSON SyntaxError from express.json()
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request payload.",
    });
  }

  // Handle CORS rejection
  if (err.message?.includes("not allowed by CORS")) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  // Handle Zod schema validation errors
  if (err instanceof ZodError) {
    const firstIssue = err.issues?.[0];
    const message = firstIssue
      ? `${firstIssue.path.join(".") || "field"}: ${firstIssue.message}`
      : "Validation error.";
    return res.status(400).json({
      success: false,
      message,
      errors: err.issues,
    });
  }

  // Handle Mongoose duplicate key error (E11000)
  if (err.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    return res.status(409).json({
      success: false,
      message: `Duplicate value for field(s): ${fields.join(", ")}.`,
    });
  }

  // Handle standard AppError or fallback
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational || statusCode < 500;

  if (statusCode >= 500) {
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
  }

  const message = isOperational
    ? err.message
    : "Internal server error. Please try again later.";

  return res.status(statusCode).json({
    success: false,
    message,
    ...(err.errorCode ? { errorCode: err.errorCode } : {}),
    ...(err.details ? { details: err.details } : {}),
  });
};
