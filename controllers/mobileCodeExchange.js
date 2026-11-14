import { createToken, getCookieOptions } from "../utils/jwtAndCookie.utils.js";
import { getCache, deleteCache } from "../utils/INMEMchahceControl.js";
import Session from "../models/auth.model.js";

export const codeExchangeController = async (req, res) => {
  try {
    const q =
      req.body && Object.keys(req.body).length > 0 ? req.body : req.query;
    const code = q?.code;
    const provider = q?.provider || "google";

    if (!code) {
      return res
        .status(400)
        .json({ message: "Code parameter is required.", success: false });
    }

    const cacheKey = `oauth:${provider}:code:${code}`;
    const value = getCache(cacheKey);
    if (!value) {
      return res
        .status(400)
        .json({ message: "code mismatch.try again", success: false });
    }

    // Immediately invalidate the one-time code to prevent concurrent duplicate session creation
    deleteCache(cacheKey);

    const { token: accessToken } = createToken(value.id, value.email, "60m");
    const { token: refreshToken, JTI: refreshTokenJTI } = createToken(
      value.id,
      value.email,
      "7d",
    );

    const isStored = await Session.create({
      JTI: refreshTokenJTI,
      owner: value.id,
    });

    if (isStored) {
      res.set("Authorization", `Bearer ${accessToken}`);
      res.cookie("refreshToken", refreshToken, getCookieOptions(req));
      return res.json({
        success: true,
        accessToken,
        refreshToken,
        access_token: accessToken,
        refresh_token: refreshToken,
      });
    }

    return res
      .status(500)
      .json({ message: "Failed to create session.", success: false });
  } catch (err) {
    console.error("Code exchange error:", err);
    res.status(500).json({
      message: "Internal server problem.",
      success: false,
    });
  }
};
