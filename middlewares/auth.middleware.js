import jwt from "jsonwebtoken";
import { config } from "../config/config.js";
import Session from "../models/auth.model.js";
import User from "../models/user.model.js";

export const authMiddleware = ({
  type = "access",
  optionalAuth = false,
} = {}) => {
  return async (req, res, next) => {
    try {
      //   let token = req.headers?.authorization.split(" ")[1];
      //   if (type.toLowerCase() == "refresh") token = req.cookies?.refresh_token;
      const authHeader = req.headers?.authorization;
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : authHeader?.trim();

      const token =
        type.trim().toLowerCase() === "refresh"
          ? req.cookies?.refreshToken ||
            req.headers["x-refresh-token"] ||
            bearerToken
          : bearerToken;
      if (optionalAuth && !token) {
        req.tokenData = null;
        return next();
      }
      if (!token) {
        return res
          .status(401)
          .json({ message: "Token not find.", success: false });
      }
      if (type.toLowerCase().trim() === "access") {
        if (!req.headers.authorization?.startsWith("Bearer "))
          return res
            .status(400)
            .json({ message: "Invalid authorization header." });
      }
      const tokenData = jwt.verify(token, config.JWT_SECRET);
      // console.log(tokenData.JTI);
      if (type.toLowerCase() === "refresh") {
        const session = await Session.findOne({
          JTI: tokenData.JTI,
          owner: tokenData.id,
        });
        // console.log(revoked);
        if (!session || session.revoked || session.exipresAt <= new Date())
          return res
            .status(404)
            .json({ message: "Token not valid.", success: false });
      }
      const user = await User.findById(tokenData.id);
      if (!user) {
        return res.status(404).json({
          message: "User not exist.",
          success: false,
        });
      }
      if (
        type.toLowerCase() !== "refresh" &&
        !req.originalUrl?.includes("completeAuth")
      ) {
        if (!user.age) {
          return res
            .status(422)
            .json({
              message:
                "Age is required. Please set your age before continuing.",
            });
        }
      }
      req.token = token;
      req.tokenData = tokenData;
      req.user = user;
      next();
    } catch (err) {
      if (optionalAuth) {
        req.tokenData = null;
        return next();
      }
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          code: "TOKEN_EXPIRED",
          message: "Access token has expired",
        });
      }

      if (err.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          code: "INVALID_TOKEN",
          message: "Invalid access token",
        });
      }

      if (err.name === "NotBeforeError") {
        return res.status(401).json({
          success: false,
          code: "TOKEN_NOT_ACTIVE",
          message: "Token is not active yet",
        });
      }
      console.log(err);
      next(err);
    }
  };
};
