import Chat from "../models/chat.model.js";
import Message from "../models/message.model.js";
import AIModel, { ensureDefaultModelsSeeded } from "../models/aiModel.model.js";
import mongoose  from "mongoose";


export const getRecentChat = async (req, res) => {
  try {
    const chatData = await Chat.find({ userId: req.tokenData.id })
      .select("topic model updatedAt")
      .sort({ updatedAt: -1 })
      .limit(20);

    return res.json({
      message: "Chats fetched successfully.",
      chats: chatData,
      success: true,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const createChat = async (req, res) => {
  try {
    const { model, topic = null } = req.body;
    if (!model) {
      return res
        .status(400)
        .json({ message: "Model name is missing.", success: false });
    }

    // Validate that the model exists and is active in the database
    let validModel = await AIModel.findOne({ modelId: model.trim(), isActive: true });
    if (!validModel) {
      // If collection is not seeded yet, seed and check again
      await ensureDefaultModelsSeeded();
      validModel = await AIModel.findOne({ modelId: model.trim(), isActive: true });
    }

    if (!validModel) {
      return res.status(400).json({
        message: `Invalid model: "${model}". Please select a valid active model from available models.`,
        success: false,
        invalidModel: true,
      });
    }

    const createdChat = await Chat.create({
      userId: req.tokenData.id,
      topic,
      model: validModel.modelId,
    });
    res.status(201).json({
      message: "Chat created successfully.",
      chatData: {
        chatId: createdChat._id,
        userId: req.tokenData.id,
        model: createdChat.model,
        topic: createdChat.topic,
      },
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Internal server error.",
    });
  }
};

export const deleteChatByID = async (req, res) => {
  try {
    const chatId = req.params?.chatId;
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({
        message: "ChatId is not a valid id.",
        success: false,
      });
    }
    const userId = req.tokenData.id;
    const chat = await Chat.findOne({ _id: chatId, userId: userId });
    if (!chat) {
      return res.status(404).json({
        message: "Chat not found.",
        success: false,
      });
    }
    const deleteMessage = await Message.deleteMany({
      chatId: chatId,
      userId: req.tokenData.id,
    });
    const deletedChat = await Chat.findOneAndDelete({
      _id: chatId,
      userId: req.tokenData.id,
    });

    if (!deletedChat) {
      return res.status(403).json({
        message: "You are not the owner of this chat",
        success: false,
      });
    }

    return res.status(200).json({
      message: "Chat deleted successfully",
      success: true,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const getChatById = async (req, res) => {
  try {
    const chatId = req.params?.chatId;
    // console.log(chatId);
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({
        message: "ChatId is not a valid id.",
        success: false,
      });
    }
    const chat = await Chat.findOne({ _id: chatId, userId: req.tokenData.id });

    if (!chat) {
      return res.status(404).json({
        message: "Chat not found.",
        success: false,
      });
    }
    res.json({
      message: "Chat fetched successfully.",
      chat,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Internal server error." });
  }
};
