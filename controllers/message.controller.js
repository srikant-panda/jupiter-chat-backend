import Message from "../models/message.model.js";
import Chat from "../models/chat.model.js";
import mongoose from "mongoose";

export const getMessage = async (req, res) => {
  try {
    const chatId = req.params?.chatId;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({
        message: "ChatId is not a valid id.",
        success: false,
      });
    }
    const userId = req.tokenData?.id;

    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat)
      return res
        .status(404)
        .json({ message: "Chat not found.", success: false });

    const messages = await Message.find({ chatId }).sort({ createdAt: 1 });
    // console.log(messages);
    res.json({
      message: "Messages fetched.",
      data: messages,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};

export { sendMessage } from "./stream-message.controller.js";
