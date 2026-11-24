import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getRecentChat,getChatById,deleteChatByID,createChat }  from "../controllers/chat.controller.js";

const chatRouter = Router();
chatRouter.use(authMiddleware())

chatRouter.get("/getRecentChat",getRecentChat );
chatRouter.post("/createChat",createChat);
chatRouter.get("/:chatId",getChatById);
chatRouter.delete("/:chatId",deleteChatByID);

export default chatRouter;