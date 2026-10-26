import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import morgan from "morgan";
import { config } from "./config/config.js";
import { connectDB } from "./config/database.js";
import authRouter from "./routes/auth.routes.js";
import userRouter from "./routes/user.routes.js";
import chatRouter from "./routes/chat.routes.js";
import messageRouter from "./routes/message.routes.js";
import cors from "cors";

const app = express();
const LOCAL_TEST = process.env.LOCAL_TEST === "true" || false;
const devOriginPattern =
  /^http:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):(5173|8081)$/;
let FRONTEND_URLS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
];
if (!LOCAL_TEST) {
  if (!process.env.VITE_FRONTEND_URL)
    throw new Error("Frontend URL is not  defined in env.");

  FRONTEND_URLS = process.env.VITE_FRONTEND_URL.split(",")
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

app.use(morgan("dev"));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (
        FRONTEND_URLS.includes(origin) ||
        (LOCAL_TEST && devOriginPattern.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
    exposedHeaders: ["Authorization", "x-refresh-token"],
  }),
);
app.use(express.json());
app.use(cookieParser());

// Behind a reverse proxy (Nginx/Render/Railway/etc.) the request arrives as
// plain HTTP internally; without this, req.secure is false and secure
// cookies are never set.
app.set("trust proxy", 1);

app.get("/", async (req, res) => {
  res.json({
    message: "Jupiter Chat backend is running...",
    status: "running",
  });
});

app.get(["/health", "/api/health"], async (req, res) => {
  res.json({
    message: "running",
  });
});

app.use("/api/auth/", authRouter);
app.use("/api/user/", userRouter);
app.use("/api/chat/", chatRouter);
app.use("/api/message/", messageRouter);

app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON",
    });
  }

  if (err.message?.includes("not allowed by CORS")) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

if (
  !process.env.GOOGLE_CLIENT_ID ||
  !process.env.GOOGLE_CLIENT_SECRET ||
  !process.env.GOOGLE_REDIRECT_URL
) {
  console.log("Google client ID,SCRET,Redirect url is need to proceed oauth.");
}

const startServer = async () => {
  try {
    await connectDB();
    app.listen(config.PORT, () => {
      console.log(`server started on port ${config.PORT}.`);
      console.log(`Allowed frontend URLs: ${FRONTEND_URLS.join(", ")}`);
    });
  } catch (err) {
    console.log(err.message);
  }
};

startServer();
