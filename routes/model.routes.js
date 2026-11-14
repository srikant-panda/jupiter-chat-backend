import { Router } from "express";
import { getAvailableModels, getModelById } from "../controllers/model.controller.js";

const modelRouter = Router();

// Public endpoints to fetch available models from the DB
modelRouter.get("/", getAvailableModels);
modelRouter.get("/:modelId", getModelById);

export default modelRouter;
