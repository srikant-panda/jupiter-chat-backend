import AIModel, { ensureDefaultModelsSeeded } from "../models/aiModel.model.js";

/**
 * Check admin privileges. Returns 200 with admin user details.
 * If user is not admin, adminMiddleware already returns 404.
 */
export const checkAdminStatus = async (req, res) => {
  return res.status(200).json({
    success: true,
    isAdmin: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      admin: true,
    },
  });
};

/**
 * Get all models from DB for admin (both active & inactive).
 */
export const getAllModelsAdmin = async (req, res) => {
  try {
    let models = await AIModel.find().sort({ order: 1, createdAt: -1 });

    if (!models || models.length === 0) {
      await ensureDefaultModelsSeeded();
      models = await AIModel.find().sort({ order: 1, createdAt: -1 });
    }

    return res.status(200).json({
      success: true,
      models,
    });
  } catch (err) {
    console.error("[getAllModelsAdmin] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching admin models.",
      error: err.message,
    });
  }
};

/**
 * Create a new AI model in the database.
 */
export const createModel = async (req, res) => {
  try {
    const {
      modelId,
      name,
      provider = "OpenRouter",
      desc = "",
      badge = "Pro",
      speed = "Balanced",
      isActive = true,
      isDefault = false,
      order = 0,
    } = req.body;

    if (!modelId || !modelId.trim()) {
      return res.status(400).json({
        success: false,
        message: "Model ID is required (e.g. 'openai/gpt-4o').",
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Display name is required.",
      });
    }

    const trimmedModelId = modelId.trim();

    const existing = await AIModel.findOne({ modelId: trimmedModelId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Model with ID "${trimmedModelId}" already exists.`,
      });
    }

    // If set as default, remove default flag from other models
    if (isDefault) {
      await AIModel.updateMany({}, { isDefault: false });
    }

    const newModel = await AIModel.create({
      modelId: trimmedModelId,
      name: name.trim(),
      provider: provider.trim(),
      desc: desc.trim(),
      badge: badge.trim(),
      speed: speed.trim(),
      isActive: Boolean(isActive),
      isDefault: Boolean(isDefault),
      order: Number(order) || 0,
    });

    return res.status(201).json({
      success: true,
      message: "Model created successfully.",
      model: newModel,
    });
  } catch (err) {
    console.error("[createModel] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to create model.",
      error: err.message,
    });
  }
};

/**
 * Update an existing AI model.
 */
export const updateModel = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      modelId,
      name,
      provider,
      desc,
      badge,
      speed,
      isActive,
      isDefault,
      order,
    } = req.body;

    const model = await AIModel.findById(id);
    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found.",
      });
    }

    // If changing modelId, ensure uniqueness
    if (modelId && modelId.trim() !== model.modelId) {
      const existing = await AIModel.findOne({ modelId: modelId.trim() });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Model ID "${modelId.trim()}" is already used by another model.`,
        });
      }
      model.modelId = modelId.trim();
    }

    if (name !== undefined) model.name = name.trim();
    if (provider !== undefined) model.provider = provider.trim();
    if (desc !== undefined) model.desc = desc.trim();
    if (badge !== undefined) model.badge = badge.trim();
    if (speed !== undefined) model.speed = speed.trim();
    if (order !== undefined) model.order = Number(order) || 0;

    if (isActive !== undefined) {
      // If deactivating, ensure at least one active model remains
      if (!isActive && model.isActive) {
        const activeCount = await AIModel.countDocuments({
          isActive: true,
          _id: { $ne: model._id },
        });
        if (activeCount === 0) {
          return res.status(400).json({
            success: false,
            message: "Cannot deactivate the only active model in the system.",
          });
        }
      }
      model.isActive = Boolean(isActive);
    }

    if (isDefault !== undefined) {
      if (isDefault) {
        await AIModel.updateMany({ _id: { $ne: model._id } }, { isDefault: false });
        model.isDefault = true;
      } else {
        model.isDefault = false;
      }
    }

    await model.save();

    return res.status(200).json({
      success: true,
      message: "Model updated successfully.",
      model,
    });
  } catch (err) {
    console.error("[updateModel] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to update model.",
      error: err.message,
    });
  }
};

/**
 * Toggle active state of a model.
 */
export const toggleModelActive = async (req, res) => {
  try {
    const { id } = req.params;
    const model = await AIModel.findById(id);

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found.",
      });
    }

    const nextState = !model.isActive;

    // If deactivating, ensure at least one other active model remains
    if (!nextState) {
      const remainingActive = await AIModel.countDocuments({
        isActive: true,
        _id: { $ne: model._id },
      });
      if (remainingActive === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot deactivate the last remaining active model.",
        });
      }
    }

    model.isActive = nextState;
    await model.save();

    return res.status(200).json({
      success: true,
      message: `Model "${model.name}" is now ${nextState ? "active" : "inactive"}.`,
      model,
    });
  } catch (err) {
    console.error("[toggleModelActive] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to toggle model active state.",
      error: err.message,
    });
  }
};

/**
 * Delete a model from DB.
 */
export const deleteModel = async (req, res) => {
  try {
    const { id } = req.params;
    const model = await AIModel.findById(id);

    if (!model) {
      return res.status(404).json({
        success: false,
        message: "Model not found.",
      });
    }

    // Safety check: Don't allow deleting the only model in database
    const totalCount = await AIModel.countDocuments();
    if (totalCount <= 1) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete the only model in the database.",
      });
    }

    // If deleting active model, ensure another active model exists
    if (model.isActive) {
      const remainingActive = await AIModel.countDocuments({
        isActive: true,
        _id: { $ne: model._id },
      });
      if (remainingActive === 0) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete the only active model. Activate another model first.",
        });
      }
    }

    // If deleting default model, designate another active model as default
    if (model.isDefault) {
      const another = await AIModel.findOne({
        _id: { $ne: model._id },
        isActive: true,
      });
      if (another) {
        another.isDefault = true;
        await another.save();
      }
    }

    await AIModel.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: `Model "${model.name}" deleted successfully.`,
    });
  } catch (err) {
    console.error("[deleteModel] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: "Failed to delete model.",
      error: err.message,
    });
  }
};
