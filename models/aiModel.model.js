import mongoose from "mongoose";

const aiModelSchema = new mongoose.Schema(
  {
    modelId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      default: "OpenRouter",
      trim: true,
    },
    desc: {
      type: String,
      default: "",
      trim: true,
    },
    badge: {
      type: String,
      default: "Pro",
      trim: true,
    },
    speed: {
      type: String,
      default: "Balanced",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

aiModelSchema.index({ isActive: 1, order: 1 });

export const DEFAULT_AI_MODELS = [
  {
    modelId: "free",
    name: "Jupiter Auto",
    provider: "Auto (Multi-Provider)",
    desc: "Dynamic multi-provider failover (Groq → OpenRouter → Gemini)",
    badge: "Auto",
    speed: "Ultra Fast",
    isActive: true,
    isDefault: true,
    order: 1,
  },
  {
    modelId: "openrouter/free",
    name: "Jupiter Free (OpenRouter)",
    provider: "OpenRouter",
    desc: "OpenRouter free tier with multi-key rotation",
    badge: "Free",
    speed: "Fast",
    isActive: true,
    isDefault: false,
    order: 2,
  },
  {
    modelId: "google/gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    desc: "State of the art multimodal & speed",
    badge: "Fast",
    speed: "Instant",
    isActive: true,
    isDefault: false,
    order: 3,
  },
  {
    modelId: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    desc: "Lightweight, smart & capable model",
    badge: "Smart",
    speed: "Very Fast",
    isActive: true,
    isDefault: false,
    order: 4,
  },
  {
    modelId: "anthropic/claude-3-haiku",
    name: "Claude 3 Haiku",
    provider: "Anthropic",
    desc: "Quick, concise, and nuanced writing",
    badge: "Quick",
    speed: "Fast",
    isActive: true,
    isDefault: false,
    order: 5,
  },
  {
    modelId: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    provider: "Meta",
    desc: "Open source powerhouse intelligence",
    badge: "Pro",
    speed: "Balanced",
    isActive: true,
    isDefault: false,
    order: 6,
  },
];

/**
 * Ensures initial default models are seeded in the database if empty.
 */
export async function ensureDefaultModelsSeeded() {
  try {
    const count = await AIModel.countDocuments();
    if (count === 0) {
      await AIModel.insertMany(DEFAULT_AI_MODELS);
      console.log(`[AIModel] Seeded ${DEFAULT_AI_MODELS.length} default AI models into the database.`);
    } else {
      // Ensure "free" is the primary default model entry
      const freeModel = await AIModel.findOne({ modelId: "free" });
      if (freeModel) {
        if (!freeModel.isDefault || freeModel.name !== "Jupiter Auto") {
          freeModel.isDefault = true;
          freeModel.name = "Jupiter Auto";
          freeModel.provider = "Auto (Multi-Provider)";
          await freeModel.save();
        }
      } else {
        await AIModel.create({
          modelId: "free",
          name: "Jupiter Auto",
          provider: "Auto (Multi-Provider)",
          desc: "Dynamic multi-provider failover (Groq → OpenRouter → Gemini)",
          badge: "Auto",
          speed: "Ultra Fast",
          isActive: true,
          isDefault: true,
          order: 1,
        });
      }
      const openRouterFree = await AIModel.findOne({ modelId: "openrouter/free" });
      if (openRouterFree) {
        let changed = false;
        if (openRouterFree.isDefault) {
          openRouterFree.isDefault = false;
          changed = true;
        }
        if (openRouterFree.name === "Jupiter Free") {
          openRouterFree.name = "Jupiter Free (OpenRouter)";
          changed = true;
        }
        if (changed) await openRouterFree.save();
      }
    }
  } catch (err) {
    console.error("[AIModel] Error verifying default models seed:", err.message);
  }
}

const AIModel = mongoose.model("AIModel", aiModelSchema);

export default AIModel;
