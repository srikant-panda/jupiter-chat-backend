import Message from "../models/message.model.js";
import Chat from "../models/chat.model.js";
import mongoose from "mongoose";
// import { success } from "zod";
import { generateAIResponse } from "../services/openrouter.service.js";
import { generatePrompt } from "../utils/generatePrompt.js";
import { chatTokenUsage } from "../utils/tokenUsage.js";
import {
  updateUserTokenUsage,
  isUsageLimitExceeded,
  resetTokenUsageIfNeeded,
} from "../utils/userUsage.js";
import { updateSummaryIfNeeded } from "../services/summary.service.js";

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

export const sendMessage = async (req, res) => {
  try {
    const { content, model = null } = req.body || {};
    const chatId = req.params?.chatId;

    if (!content || content.trim() === "") {
      return res.status(400).json({
        message: "Content not found. Provide content.",
        success: false,
      });
    }
    await resetTokenUsageIfNeeded(req.user);

    if (isUsageLimitExceeded(req.user)) {
      return res.status(429).json({
        message: "You are exceeded the limit.",
        success: false,
      });
    }

    let chat;
    if (chatId) {
      if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({
          message: "ChatId is not a valid id.",
          success: false,
        });
      }
      chat = await Chat.findOne({
        _id: chatId,
        userId: req.tokenData.id,
      });
      if (!chat) {
        return res.status(404).json({
          message: "Chat not found",
          success: false,
        });
      }
    } else {
      const selectedModel = model || process.env.DEFAULT_AI_MODEL;
      if (!selectedModel) {
        return res.status(400).json({
          message: "Model not provided.",
          success: false,
        });
      }
      chat = await Chat.create({
        userId: req.tokenData.id,
        model: selectedModel,
      });
    }

    const recentMessageHistory = await Message.find({ chatId: chat._id })
      .sort({ createdAt: 1 })
      .skip(chat.summarizedTillMessageNumber);

    const prepareMessage = generatePrompt({
      summary: chat.summary,
      history: recentMessageHistory,
      currentMessage: content.trim(),
      user: req.user,
    });

    const { result, usage } = await generateAIResponse({
      model: model ? model : chat.model,
      messages: prepareMessage,
    });

    const userMessage = await Message.create({
      userId: req.tokenData.id,
      chatId: chat._id,
      role: "user",
      content: content.trim(),
      tokens: usage?.promptTokens,
      usage: {
        promptTokens: usage?.promptTokens,
        completionTokens: 0,
        totalTokens: usage?.promptTokens,
      },
    });

    const assistantMessage = await Message.create({
      userId: req.tokenData.id,
      chatId: chat._id,
      role: "assistant",
      content: result,
      tokens: usage.completionTokens,
      usage,
    });

    chat.messageCount += 2;
    if ((chat.topic || "new chat").toLowerCase() === "new chat") {
      chat.topic = content.trim().slice(0, 40);
    }
    await chatTokenUsage(chat, usage);
    await chat.save();

    await updateUserTokenUsage(req.user, usage);

    res.json({
      message: "Response generated.",
      data: {
        chatId: chat._id,
        messageId: assistantMessage._id,
        role: assistantMessage.role,
        reply: assistantMessage.content,
        usage,
        userMessage,
        assistantMessage,
      },
    });

    updateSummaryIfNeeded(chat._id).catch((err) =>
      console.log("Summary update error:", err.message),
    );
  } catch (err) {
    console.log(err.message);
    return res.status(500).json({
      message: err.message || "Internal server error.",
      success: false,
    });
  }
};
