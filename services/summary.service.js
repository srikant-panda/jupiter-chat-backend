import Chat from "../models/chat.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { generateAIResponse } from "./openrouter.service.js";
import { chatTokenUsage } from "../utils/tokenUsage.js";
import { updateUserTokenUsage } from "../utils/userUsage.js";

const SUMMARY_CHUNK_SIZE = 20;

export const updateSummaryIfNeeded = async (chatId) => {
  const chat = await Chat.findById(chatId);
  if (!chat) return;
  const unsummarizedMessage =
    chat.messageCount - chat.summarizedTillMessageNumber;
  if (unsummarizedMessage < SUMMARY_CHUNK_SIZE) return;

  const messagesToSummarize = await Message.find({ chatId })
    .sort({ createdAt: 1 })
    .skip(chat.summarizedTillMessageNumber)
    .limit(20);
  if (messagesToSummarize.length === 0) return;

  const summarymessage = [
    {
      role: "system",
      content:
        "Summarize the conversation. Keep important context, user goals, decisions, and unresolved doubts. Do not add extra information.",
    },
    {
      role: "system",
      content: `Previous summary: ${chat.summary || "No previous summary yet."}`,
    },
    ...messagesToSummarize.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: "user",
      content: "Summarize the above conversation.",
    },
  ];


  const chatModelDoc = await (await import("../models/aiModel.model.js")).default.findOne({
    modelId: chat.model,
  });
  const { result, usage } = await generateAIResponse({
    model: chat.model,
    provider: chatModelDoc?.provider,
    messages: summarymessage,
  });

  chat.summary = result;
  chat.summarizedTillMessageNumber += messagesToSummarize.length;
  chat.summaryUpdatedAt = new Date();

  const saveChatUsage = await chatTokenUsage( chat , usage );
  if(saveChatUsage){
    const user = await User.findById(chat.userId);
    if(user){
        await updateUserTokenUsage(user,usage);

    }
  }
  return true;
};
