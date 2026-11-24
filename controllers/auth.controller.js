import User from "../models/user.model.js";
import Session from "../models/auth.model.js";
import bcrypt from "bcrypt";
import { signupSchema, signinSchema } from "../validators/user.schema.js";
import { createToken, getCookieOptions } from "../utils/jwtAndCookie.utils.js";

export const signupController = async (req, res) => {
  try {
    const result = signupSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        errors: result.error.issues,
      });
    }
    const { email, password, name, age } = result.data || {};
    if (!email || !password || !name || !age) {
      return res.status(400).json({
        message: "Email , password or name some filed are missing",
        success: false,
      });
    }
    const user = await User.findOne({ email });
    if (user) {
      return res.status(409).json({
        message: "user with this email alredy exist.",
        success: false,
      });
    }
    const hashPassword = await bcrypt.hash(password, 12);
    const userCreated = await User.create({
      name,
      email,
      age,
      password: hashPassword,
      method: {
        name: "email",
      },
    });
    if (userCreated) {
      const { token: accessToken, JTI: accessTokenJTI } = createToken(
        userCreated._id,
        email,
        "15m",
      );
      const { token: refreshToken, JTI: refreshTokenJTI } = createToken(
        userCreated._id,
        email,
        "7d",
      );
      // Never log session credentials.
      const isStored = await Session.create({
        JTI: refreshTokenJTI,
        owner: userCreated._id,
      });
      res.set("Authorization", `Bearer ${accessToken}`);
      // res.set("x-refresh-token", refreshToken);
      res.cookie("refreshToken", refreshToken, getCookieOptions(req));
      res
        .status(201)
        .json({
          message: "User created.",
          success: true,
          accessToken,
          refreshToken,
        });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const loginController = async (req, res) => {
  try {
    const isAlrdyLogdin = req.tokenData || null;
    if (isAlrdyLogdin) {
      return res.json({
        message: "User already logged in.",
        success: true,
      });
    }
    // const { email, password } = req.body;
    const result = signinSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        errors: result.error.issues,
      });
    }
    const { email, password } = result.data || {};
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ message: "User not found.", success: false });
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched)
      return res
        .status(401)
        .json({ message: "Invalid credentials.", success: false });
    if (isPasswordMatched) {
      const { token: accessToken, JTI: accessTokenJTI } = createToken(
        user._id,
        email,
        "15m",
      );
      const { token: refreshToken, JTI: refreshTokenJTI } = createToken(
        user._id,
        email,
        "7d",
      );
      const isStored = await Session.create({
        JTI: refreshTokenJTI,
        owner: user._id,
      });
      res.set("Authorization", `Bearer ${accessToken}`);
      res.cookie("refreshToken", refreshToken, getCookieOptions(req));
      res.json({
        message: "User logged in.",
        success: true,
        accessToken,
        refreshToken,
      });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const logoutCotroller = async (req, res) => {
  try {
    const { id, JTI } = req.tokenData;
    const user = await User.findById(id);
    if (!user)
      return res
        .status(404)
        .json({ message: "User not found.", success: false });
    const isUpdated = await Session.findOneAndUpdate(
      { JTI },
      { revoked: true },
    );
    console.log(isUpdated);
    if (isUpdated) {
      // Clearing a cookie must use the same attributes as the cookie that was
      // set, otherwise browsers can retain the production cookie.
      res.clearCookie("refreshToken", getCookieOptions(req));
      res.json({ message: "User logged Out.", success: true });
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error", success: false });
  }
};

export const refreshController = async (req, res) => {
  try {
    const { token: newaccessToken } = createToken(
      req.tokenData.id,
      req.user.email,
      "15m",
    );

    res.header("Authorization", `Bearer ${newaccessToken}`);
    res.json({
      message: "Token refreshed.",
      success: true,
      accessToken: newaccessToken,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const completeAuth = async (req, res) => {
  try {
    const { age } = req.body || {};
    if (!age) {
      return res.status(400).json({
        message: "Age is not defined.So provide age.",
        success: false,
      });
    }
    req.user.age = age;
    await req.user.save();
    return res.json({
      message: "Age updated.",
      success: true,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};
