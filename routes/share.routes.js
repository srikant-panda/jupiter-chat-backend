import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  createShare,
  listShares,
  revokeShare,
  readShare,
} from "../controllers/share.controller.js";
const router = Router();
router.get("/", authMiddleware(), listShares);
router.post("/chat/:chatId", authMiddleware(), createShare);
router.delete("/:token", authMiddleware(), revokeShare);
router.get("/:token", readShare);
export default router;
