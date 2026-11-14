import AIModel, { ensureDefaultModelsSeeded } from "../models/aiModel.model.js";

/**
 * Fetch all available active AI models from the database.
 * Auto-seeds default models if the collection is empty.
 */
export const getAvailableModels = async (req, res) => {
  try {
    let models = await AIModel.find({ isActive: true }).sort({ order: 1, createdAt: 1 });

    if (!models || models.length === 0) {
      await ensureDefaultModelsSeeded();
      models = await AIModel.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    }

    const defaultModelDoc =
      models.find((m) => m.isDefault) ||
      models[0] ||
      null;

    return res.status(200).json({
      success: true,
      message: "Models fetched successfully.",
      models,
      defaultModel: defaultModelDoc ? defaultModelDoc.modelId : "openrouter/free",
    });
  } catch (err) {
    console.error("[getAvailableModels] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching models.",
      error: err.message,
    });
  }
};

/**
 * Fetch a single AI model by its modelId.
 */
export const getModelById = async (req, res) => {
  try {
    const { modelId } = req.params;
    if (!modelId) {
      return res.status(400).json({
        success: false,
        message: "Model ID is required.",
      });
    }

    // Support encoded slashes (e.g., openai/gpt-4o-mini)
    const decodedModelId = decodeURIComponent(modelId);

    const model = await AIModel.findOne({
      modelId: decodedModelId,
      isActive: true,
    });

    if (!model) {
      return res.status(404).json({
        success: false,
        message: `Model "${decodedModelId}" not found or inactive.`,
      });
    }

    return res.status(200).json({
      success: true,
      model,
    });
  } catch (err) {
    console.error("[getModelById] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: err.message,
    });
  }
};
