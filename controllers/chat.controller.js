import Chat from "../models/chat.model.js";
import Message from "../models/message.model.js";
import SharedChat from "../models/sharedChat.model.js";
import AIModel, { ensureDefaultModelsSeeded } from "../models/aiModel.model.js";
import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/appError.js";

export const getRecentChat = asyncHandler(async (req, res) => {
  const chatData = await Chat.find({ userId: req.tokenData.id })
    .select("topic model updatedAt")
    .sort({ updatedAt: -1 })
    .limit(20);

  return res.json({
    message: "Chats fetched successfully.",
    chats: chatData,
    success: true,
  });
});

export const createChat = asyncHandler(async (req, res) => {
  const { model, topic = null } = req.body;
  if (!model) {
    throw new AppError("Model name is missing.", 400);
  }

  const requestedModel = model.trim();
  const normalizedModelId = requestedModel;

  // Validate that the model exists and is active in the database
  let validModel = await AIModel.findOne({
    modelId: normalizedModelId,
    isActive: true,
  });

  if (!validModel) {
    await ensureDefaultModelsSeeded();
    validModel = await AIModel.findOne({
      modelId: normalizedModelId,
      isActive: true,
    });
  }

  // Allow "free" as a builtin valid model
  if (!validModel && normalizedModelId === "free") {
    validModel = { modelId: "free" };
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
});

export const deleteChatByID = asyncHandler(async (req, res) => {
  const chatId = req.params?.chatId;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new AppError("ChatId is not a valid id.", 400);
  }

  const userId = req.tokenData.id;
  const chat = await Chat.findOne({ _id: chatId, userId });
  if (!chat) {
    throw new AppError("Chat not found.", 404);
  }

  await SharedChat.deleteMany({ chatId, userId });
  await Message.deleteMany({ chatId, userId });
  const deletedChat = await Chat.findOneAndDelete({ _id: chatId, userId });

  if (!deletedChat) {
    throw new AppError("You are not the owner of this chat", 403);
  }

  return res.status(200).json({
    message: "Chat deleted successfully",
    success: true,
  });
});

export const getChatById = asyncHandler(async (req, res) => {
  const chatId = req.params?.chatId;
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    throw new AppError("ChatId is not a valid id.", 400);
  }

  const chat = await Chat.findOne({ _id: chatId, userId: req.tokenData.id });
  if (!chat) {
    throw new AppError("Chat not found.", 404);
  }

  res.json({
    message: "Chat fetched successfully.",
    chat,
  });
});
