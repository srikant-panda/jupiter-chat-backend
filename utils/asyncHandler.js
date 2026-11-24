/**
 * Wraps an async route handler or middleware to automatically forward
 * unhandled rejections to the next(err) Express error middleware.
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
