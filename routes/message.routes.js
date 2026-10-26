// import { Router } from "express"; 
// import { authMiddleware } from "../middlewares/auth.middleware.js";
// import { getMessage,sendMessage } from "../controllers/message.controller.js";


// const messageRouter = Router();

// /**
//  * 1- getMessage
//  * 2- sendMessage
//  */
// messageRouter.use(authMiddleware())

// messageRouter.get("/:chatId",getMessage);
// messageRouter.post("/:chatId",sendMessage);
// messageRouter.post("/",sendMessage)

// export default messageRouter;



import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getMessage, sendMessage } from "../controllers/message.controller.js";
import { streamMessage } from "../controllers/stream-message.controller.js";

const messageRouter = Router();
messageRouter.use(authMiddleware());

// IMPORTANT: keep /stream before /:chatId so "stream" is not treated as a chat id.
messageRouter.post("/stream", streamMessage);
messageRouter.post("/:chatId/stream", streamMessage);
messageRouter.post("/", sendMessage);
messageRouter.post("/:chatId", sendMessage);
messageRouter.get("/:chatId", getMessage);

export default messageRouter;
