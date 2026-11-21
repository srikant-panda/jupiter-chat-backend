import { Router } from "express";
import * as userController from "../controllers/user.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const userRouter = Router();

userRouter.get("/get-me", authMiddleware(), userController.getMe);
userRouter.patch("/profile", authMiddleware(), userController.updateProfile);
userRouter.delete("/", authMiddleware(), userController.deleteUser);
userRouter.get("/delete-user", authMiddleware(), userController.deleteUser);

export default userRouter;
