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
    modelId: "openrouter/free",
    name: "Jupiter Free",
    provider: "OpenRouter",
    desc: "Fast, intelligent, everyday reasoning with dynamic auto-failover",
    badge: "Free",
    speed: "Ultra Fast",
    isActive: true,
    isDefault: true,
    order: 1,
  },
  {
    modelId: "free",
    name: "Jupiter Free",
    provider: "Auto (Multi-Provider)",
    desc: "Fast, intelligent, everyday reasoning with dynamic auto-failover",
    badge: "Free",
    speed: "Ultra Fast",
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
      // Ensure "openrouter/free" is the primary default model entry
      const openRouterFree = await AIModel.findOne({ modelId: "openrouter/free" });
      if (openRouterFree) {
        if (!openRouterFree.isDefault) {
          openRouterFree.isDefault = true;
          openRouterFree.name = "Jupiter Free";
          await openRouterFree.save();
        }
      }
      const freeExists = await AIModel.exists({ modelId: "free" });
      if (!freeExists) {
        await AIModel.create({
          modelId: "free",
          name: "Jupiter Free",
          provider: "Auto (Multi-Provider)",
          desc: "Fast, intelligent, everyday reasoning with dynamic auto-failover",
          badge: "Free",
          speed: "Ultra Fast",
          isActive: true,
          isDefault: false,
          order: 2,
        });
      }
    }
  } catch (err) {
    console.error("[AIModel] Error verifying default models seed:", err.message);
  }
}

const AIModel = mongoose.model("AIModel", aiModelSchema);

export default AIModel;
