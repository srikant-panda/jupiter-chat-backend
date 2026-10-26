import dotenv from "dotenv";

dotenv.config();

if (!process.env.PORT) {
  console.log("Port is not defind in the env , Running on default port 3000");
}
if (!process.env.MONGO_URI) {
  throw new Error("Mongodb URI is not defined in env . DB connection failed.");
}
if (!process.env.JWT_SECRET) {
  throw new Error("JWT Secret key is Missing");
}
if(!process.env.OPENROUTER_API_KEY){
  throw new Error("OpenRouter is not defined.")
}


export const config = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI,
  JWT_SECRET:process.env.JWT_SECRET,
  OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY,
  // Treat either an explicit production flag or the hosting platform's
  // standard NODE_ENV value as production. This is used by cookie settings.
  PRODUCTION:
    (process.env.PRODUCTION === "true" || process.env.NODE_ENV === "production") &&
    process.env.LOCAL_TEST !== "true" 
};

