import dotenv from "dotenv";

dotenv.config();

if (!process.env.PORT) {
  console.log("Port is not defined in the env, running on default port 3000");
}
if (!process.env.MONGO_URI) {
  throw new Error("Mongodb URI is not defined in env. DB connection failed.");
}
if (!process.env.JWT_SECRET) {
  throw new Error("JWT Secret key is missing.");
}
if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OpenRouter API key is missing.");
}

const parseKeys = (raw) =>
  raw
    ? raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

export const config = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_API_KEYS: parseKeys(process.env.OPENROUTER_API_KEY),
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  GROQ_API_KEYS: parseKeys(process.env.GROQ_API_KEY),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  GEMINI_API_KEYS: parseKeys(process.env.GEMINI_API_KEY),
  API_KEY_COOLDOWN_HOURS: Number(process.env.API_KEY_COOLDOWN_HOURS) || 4,
  PROVIDER_TIMEOUT_MS: Number(process.env.PROVIDER_TIMEOUT_MS) || 12000,
  SINGLE_PROVIDER_TIMEOUT_MS: Number(process.env.SINGLE_PROVIDER_TIMEOUT_MS) || 60000,
  DEFAULT_AI_MODEL: process.env.DEFAULT_AI_MODEL || "free",
  OPENROUTER_FREE_MODEL:
    process.env.OPENROUTER_FREE_MODEL || "openrouter/free",
  GROQ_FREE_MODEL: process.env.GROQ_FREE_MODEL || "llama-3.3-70b-versatile",
  GEMINI_FREE_MODEL: process.env.GEMINI_FREE_MODEL || "gemini-2.0-flash",
  // Model pools: empty by default; user fills in desired fallback models in env
  OPENROUTER_MODELS: parseKeys(process.env.OPENROUTER_MODELS),
  GROQ_MODELS: parseKeys(process.env.GROQ_MODELS),
  GEMINI_MODELS: parseKeys(process.env.GEMINI_MODELS),
  // Treat either an explicit production flag or the hosting platform's
  // standard NODE_ENV value as production. This is used by cookie settings.
  PRODUCTION:
    (process.env.PRODUCTION === "true" || process.env.NODE_ENV === "production") &&
    process.env.LOCAL_TEST !== "true",
};
