import mongoose from "mongoose";
import Message from "../models/message.model.js";
import Chat from "../models/chat.model.js";
import AIModel from "../models/aiModel.model.js";
import { generatePrompt } from "../utils/generatePrompt.js";
import { generateAnswer } from "../services/answer.service.js";
import {
  updateUserTokenUsage,
  isUsageLimitExceeded,
  resetTokenUsageIfNeeded,
} from "../utils/userUsage.js";
import { updateSummaryIfNeeded } from "../services/summary.service.js";
import { messageRequest } from "../validators/message.schema.js";

const event = (res, name, data) => {
  if (!res.destroyed && !res.writableEnded)
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
};
export const streamMessage = (req, res) => respond(req, res, true);
export const sendMessage = (req, res) => respond(req, res, false);

async function respond(req, res, streaming) {
  let heartbeat;
  try {
    const parsed = messageRequest.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: parsed.error.issues[0].message });
    const { content, model, temporary, history } = parsed.data;
    const chatId = req.params.chatId;
    if (temporary && chatId)
      return res
        .status(400)
        .json({ message: "Temporary chats cannot use a saved conversation." });
    if (!temporary && history.length)
      return res
        .status(400)
        .json({ message: "History is only accepted for temporary chats." });
    await resetTokenUsageIfNeeded(req.user);
    if (isUsageLimitExceeded(req.user))
      return res
        .status(429)
        .json({ message: "Your token limit has been reached." });
    let chat;
    if (chatId) {
      if (!mongoose.isValidObjectId(chatId))
        return res.status(400).json({ message: "ChatId is not a valid id." });
      chat = await Chat.findOne({ _id: chatId, userId: req.tokenData.id });
      if (!chat) return res.status(404).json({ message: "Chat not found." });
    }
    const defaultModel =
      !model && !chat
        ? await AIModel.findOne({ isDefault: true, isActive: true })
        : null;
    const modelId =
      model ||
      chat?.model ||
      defaultModel?.modelId ||
      process.env.DEFAULT_AI_MODEL ||
      "openrouter/free";
    if (!(await AIModel.exists({ modelId, isActive: true })))
      return res.status(400).json({
        message: "Select an available, active model.",
        invalidModel: true,
      });
    if (!temporary && !chat)
      chat = await Chat.create({
        userId: req.tokenData.id,
        model: modelId,
        topic: content.slice(0, 40),
      });
    const prior = temporary
      ? history
      : await Message.find({ chatId: chat._id })
          .sort({ createdAt: 1 })
          .skip(chat.summarizedTillMessageNumber);
    const prepared = generatePrompt({
      summary: chat?.summary,
      history: prior,
      currentMessage: content,
      user: req.user,
    });
    const needsTitle =
      !temporary &&
      !chat.titleGenerated &&
      !(await Message.exists({ chatId: chat._id, role: "assistant" }));
    let userMessage;
    if (!temporary) {
      userMessage = await Message.create({
        userId: req.tokenData.id,
        chatId: chat._id,
        role: "user",
        content,
      });
      await Chat.updateOne(
        { _id: chat._id },
        { $set: { model: modelId }, $inc: { messageCount: 1 } },
      );
    }
    if (streaming) {
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
      event(res, "chat", {
        chatId: chat?._id || null,
        topic: chat?.topic || "Temporary chat",
        model: modelId,
        temporary,
      });
      heartbeat = setInterval(() => {
        if (!res.destroyed) res.write(": heartbeat\n\n");
      }, 15000);
      res.on("close", () => clearInterval(heartbeat));
    }
    const { result, title, usage } = await generateAnswer({
      model: modelId,
      messages: prepared,
      onToken: streaming ? (text) => event(res, "token", { text }) : undefined,
    });
    let assistantMessage;
    if (!temporary) {
      assistantMessage = await Message.create({
        userId: req.tokenData.id,
        chatId: chat._id,
        role: "assistant",
        content: result,
        tokens: usage.completionTokens,
        usage,
      });
      await Message.updateOne(
        { _id: userMessage._id },
        {
          $set: {
            tokens: usage.promptTokens,
            usage: {
              promptTokens: usage.promptTokens,
              completionTokens: 0,
              totalTokens: usage.promptTokens,
            },
          },
        },
      );
      // First successful response wins, even if requests finish out of order.
      await Chat.updateOne(
        { _id: chat._id, titleGenerated: { $ne: true } },
        {
          $set: {
            ...(needsTitle ? { topic: title } : {}),
            titleGenerated: true,
          },
        },
      );
      chat = await Chat.findByIdAndUpdate(
        chat._id,
        {
          $inc: {
            messageCount: 1,
            "usage.promptTokens": usage.promptTokens,
            "usage.completionTokens": usage.completionTokens,
            "usage.totalTokens": usage.totalTokens,
          },
        },
        { returnDocument: "after" },
      );
    }
    await updateUserTokenUsage(req.user, usage);
    const data = {
      chatId: chat?._id || null,
      messageId: assistantMessage?._id || null,
      role: "assistant",
      reply: result,
      usage,
      topic: chat?.topic || title,
      messageCount: chat?.messageCount || history.length + 2,
      temporary,
    };
    if (streaming) {
      event(res, "done", data);
      res.end();
    } else
      res.json({
        success: true,
        data: { ...data, userMessage, assistantMessage },
      });
    if (chat)
      updateSummaryIfNeeded(chat._id).catch((err) =>
        console.error("Summary update failed:", err.message),
      );
  } catch (err) {
    console.error("Response failed:", err.message);
    const message =
      "Could not complete the response. Please retry or select another model.";
    if (res.headersSent) {
      event(res, "error", { message });
      res.end();
    } else res.status(502).json({ success: false, message });
  } finally {
    clearInterval(heartbeat);
  }
}
