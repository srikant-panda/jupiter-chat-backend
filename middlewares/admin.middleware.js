import User from "../models/user.model.js";

/**
 * Middleware that verifies if the authenticated user has admin privileges.
 * Directly queries the database to ensure the user document has admin: true.
 * If not authenticated or not an admin, responds with 404 to avoid leaking admin routes.
 */
export const adminMiddleware = async (req, res, next) => {
  try {
    const userId = req.tokenData?.id || req.user?._id;
    if (!userId) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    // Always fetch fresh user record directly from database
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const isAdmin = Boolean(user.admin === true || user.isAdmin === true);
    if (!isAdmin) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    req.user = user;
    req.isAdmin = true;
    next();
  } catch (err) {
    console.error("[adminMiddleware] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
