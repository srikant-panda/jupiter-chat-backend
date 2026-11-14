import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { adminMiddleware } from "../middlewares/admin.middleware.js";
import {
  checkAdminStatus,
  getAllModelsAdmin,
  createModel,
  updateModel,
  toggleModelActive,
  deleteModel,
} from "../controllers/admin.controller.js";

const adminRouter = Router();

// Both authentication and admin verification are required for all admin routes.
// Non-admin / unauthenticated requests receive 404 Not Found.
adminRouter.use(authMiddleware());
adminRouter.use(adminMiddleware);

adminRouter.get("/check", checkAdminStatus);
adminRouter.get("/models", getAllModelsAdmin);
adminRouter.post("/models", createModel);
adminRouter.put("/models/:id", updateModel);
adminRouter.patch("/models/:id/toggle", toggleModelActive);
adminRouter.delete("/models/:id", deleteModel);

export default adminRouter;
