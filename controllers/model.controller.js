import AIModel, { ensureDefaultModelsSeeded } from "../models/aiModel.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/appError.js";

/**
 * Fetch all available active AI models from the database.
 * Auto-seeds default models if the collection is empty.
 */
export const getAvailableModels = asyncHandler(async (req, res) => {
  let models = await AIModel.find({ isActive: true }).sort({ order: 1, createdAt: 1 });

  if (!models || models.length === 0) {
    await ensureDefaultModelsSeeded();
    models = await AIModel.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
  }

  const defaultModelDoc =
    models.find((m) => m.isDefault) ||
    models.find((m) => m.modelId === "free") ||
    models[0] ||
    null;

  return res.status(200).json({
    success: true,
    message: "Models fetched successfully.",
    models,
    defaultModel: defaultModelDoc ? defaultModelDoc.modelId : "free",
  });
});

/**
 * Fetch a single AI model by its modelId.
 */
export const getModelById = asyncHandler(async (req, res) => {
  const { modelId } = req.params;
  if (!modelId) {
    throw new AppError("Model ID is required.", 400);
  }

  // Support encoded slashes (e.g., openai/gpt-4o-mini)
  const decodedModelId = decodeURIComponent(modelId);
  const normalizedId =
    decodedModelId === "openrouter/free" ? "free" : decodedModelId;

  const model = await AIModel.findOne({
    modelId: normalizedId,
    isActive: true,
  });

  if (!model) {
    throw new AppError(`Model "${decodedModelId}" not found or inactive.`, 404);
  }

  return res.status(200).json({
    success: true,
    model,
  });
});
