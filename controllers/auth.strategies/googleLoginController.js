import { google } from "googleapis";
import crypto from "crypto";
import User from "../../models/user.model.js";
import { createUser } from "../../utils/userCreate.js";
import { sendTokens } from "../../utils/jwtAndCookie.utils.js";
import {
  setCache,
  getCache,
  deleteCache,
} from "../../utils/INMEMchahceControl.js";


export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URL,
);

export const googeleLoginHandler = async (req, res) => {
  const isAlrdyLogdin = req.tokenData || null;
  if (isAlrdyLogdin) {
    return res.json({
      message: "User already logged in.",
      success: true,
    });
  }
  const q = req.query;
  if (!q.redirect_url)
    return res
      .status(400)
      .json({ message: "no redirect url specified in query.", success: false });
  const state = crypto.randomBytes(32).toString("hex");
  setCache(
    `oauth:state:${state}`,
    { provider: "google", redirectUrl: q.redirect_url },
    5 * 60 * 1000,
  );
  const scopes = ["openid", "profile", "email"];
  const authorizeURL = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    state: state,
  });
  res.redirect(authorizeURL);
};

export const googleCallbackHandler = async (req, res) => {
  const q = req.query;
  if (q.error) {
    // An error response e.g. error=access_denied
    console.log("Error:" + q.error);
    return res.json({ messgae: "login failed." });
  }
  const value = getCache(`oauth:state:${q.state}`);
  console.log(value, q.state);
  if (!value) {
    console.log("State mismatch. Possible CSRF attack");
    return res.status(400).json({ message: "State mismatch. Possible CSRF attack" });
  }
  const { redirectUrl } = value;
  deleteCache(`oauth:state:${q.state}`);
  const { tokens } = await oauth2Client.getToken(q.code);
  console.log(tokens);
  const id_data = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  console.log(id_data);

  let user = await User.findOne({ email: id_data.payload.email });
  if (!user) {
    user = await createUser({
      name: id_data.payload.name,
      email: id_data.payload.email,
      method: "google",
    });
  }
  console.log(user);
  const code = crypto.randomBytes(32).toString("hex");
  setCache(`oauth:google:code:${code}`, { provider: "google",id:user._id,email:user.email }, 5 * 60 * 1000);
  const baseRedirect = redirectUrl || "http://localhost:5173/auth/callback";
  const separator = baseRedirect.includes("?") ? "&" : "?";
  const redirect = `${baseRedirect}${separator}code=${code}&provider=google`;
  res.redirect(redirect);
};
