import Message from "../models/message.model.js";
import Chat from "../models/chat.model.js";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/appError.js";

export const getMessage = asyncHandler(async (req, res) => {
  const chatId = req.params?.chatId;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new AppError("ChatId is not a valid id.", 400);
  }
  const userId = req.tokenData?.id;

  const chat = await Chat.findOne({ _id: chatId, userId });
  if (!chat) {
    throw new AppError("Chat not found.", 404);
  }

  const messages = await Message.find({ chatId }).sort({ createdAt: 1 });
  res.json({
    message: "Messages fetched.",
    data: messages,
  });
});

export { sendMessage } from "./stream-message.controller.js";
