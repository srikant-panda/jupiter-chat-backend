import mongoose from "mongoose";
import Message from "../models/message.model.js";
import Chat from "../models/chat.model.js";
import { generatePrompt } from "../utils/generatePrompt.js";
import { chatTokenUsage } from "../utils/tokenUsage.js";
import {
  updateUserTokenUsage,
  isUsageLimitExceeded,
  resetTokenUsageIfNeeded,
} from "../utils/userUsage.js";
import { updateSummaryIfNeeded } from "../services/summary.service.js";
import { generateAIResponse } from "../services/openrouter.service.js";
import {
  generateAIResponseStream,
  isStreamingNotSupportedError,
} from "../services/openrouter.stream.service.js";

const sendEvent = (res, event, data) => {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export const streamMessage = async (req, res) => {
  let chat;
  let userMessage;

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

    if (chatId) {
      if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return res.status(400).json({ message: "ChatId is not a valid id.", success: false });
      }

      chat = await Chat.findOne({
        _id: chatId,
        userId: req.tokenData.id,
      });

      if (!chat) {
        return res.status(404).json({ message: "Chat not found", success: false });
      }
    } else {
      const selectedModel = model || process.env.DEFAULT_AI_MODEL;

      if (!selectedModel) {
        return res.status(400).json({ message: "Model not provided.", success: false });
      }

      chat = await Chat.create({
        userId: req.tokenData.id,
        model: selectedModel,
      });
    }

    const recentMessageHistory = await Message.find({ chatId: chat._id })
      .sort({ createdAt: 1 })
      .skip(chat.summarizedTillMessageNumber);

    const preparedMessages = generatePrompt({
      summary: chat.summary,
      history: recentMessageHistory,
      currentMessage: content.trim(),
      user:req.user
    });

    // Create the user message immediately so the conversation is durable
    // even while the assistant is streaming.
    userMessage = await Message.create({
      userId: req.tokenData.id,
      chatId: chat._id,
      role: "user",
      content: content.trim(),
      tokens: 0,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    });

    if ((chat.topic || "new chat").toLowerCase() === "new chat") {
      chat.topic = content.trim().slice(0, 40);
    }

    await chat.save();

    // Start SSE before calling OpenRouter so the browser can immediately
    // receive the chat id and switch to /chat/:chatId.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    sendEvent(res, "chat", {
      chatId: chat._id,
      topic: chat.topic,
      model: chat.model,
    });

    let streamClosed = false;
    req.on("close", () => {
      streamClosed = true;
    });

    let result;
    let usage;
    let tokenSent = false;

    try {
      const streamData = await generateAIResponseStream({
        model: model ? model : chat.model,
        messages: preparedMessages,
        onToken: async (text) => {
          tokenSent = true;
          if (!streamClosed) sendEvent(res, "token", { text });
        },
        onUsage: async () => {},
      });
      result = streamData.result;
      usage = streamData.usage;
    } catch (streamErr) {
      if (!tokenSent && isStreamingNotSupportedError(streamErr)) {
        console.warn(
          `[Stream Message Controller] Model does not support streaming (${streamErr.message}). Using classic request-response...`
        );
        const classicData = await generateAIResponse({
          model: model ? model : chat.model,
          messages: preparedMessages,
        });
        result = classicData.result;
        usage = classicData.usage;
        if (!streamClosed && result) {
          sendEvent(res, "token", { text: result });
        }
      } else {
        throw streamErr;
      }
    }

    const assistantMessage = await Message.create({
      userId: req.tokenData.id,
      chatId: chat._id,
      role: "assistant",
      content: result,
      tokens: usage.completionTokens,
      usage,
    });

    userMessage.tokens = usage.promptTokens;
    userMessage.usage = {
      promptTokens: usage.promptTokens,
      completionTokens: 0,
      totalTokens: usage.promptTokens,
    };
    await userMessage.save();

    chat.messageCount += 2;
    await chatTokenUsage(chat, usage);
    await chat.save();
    await updateUserTokenUsage(req.user, usage);

    if (!streamClosed) {
      sendEvent(res, "done", {
        chatId: chat._id,
        messageId: assistantMessage._id,
        role: assistantMessage.role,
        reply: result,
        usage,
        topic: chat.topic,
        messageCount: chat.messageCount,
      });
      res.end();
    }
    // console.log(assistantMessage.content);

    updateSummaryIfNeeded(chat._id).catch((err) =>
      console.log("Summary update error:", err.message),
    );
  } catch (err) {
    console.log("Streaming message error:", err.message);

    if (res.headersSent) {
      sendEvent(res, "error", { message: err.message || "Internal server error." });
      res.end();
    } else {
      return res.status(500).json({
        message: err.message || "Internal server error.",
        success: false,
      });
    }
  }
};
