import crypto from "node:crypto";
import mongoose from "mongoose";
import Chat from "../models/chat.model.js";
import Message from "../models/message.model.js";
import SharedChat from "../models/sharedChat.model.js";

export async function createShare(req, res) {
  if (!mongoose.isValidObjectId(req.params.chatId))
    return res.status(400).json({ message: "Invalid chat." });
  const chat = await Chat.findOne({
    _id: req.params.chatId,
    userId: req.tokenData.id,
  });
  if (!chat) return res.status(404).json({ message: "Chat not found." });
  const messages = await Message.find({
    chatId: chat._id,
    role: { $in: ["user", "assistant"] },
  })
    .sort({ createdAt: 1 })
    .select("role content -_id")
    .limit(501)
    .lean();
  if (!messages.some((m) => m.role === "assistant"))
    return res
      .status(400)
      .json({ message: "Wait for an answer before sharing." });
  if (messages.length > 500 || JSON.stringify(messages).length > 2000000)
    return res
      .status(413)
      .json({ message: "This conversation is too large to share." });
  // Reusing an existing link never silently exposes new messages.
  let share;
  try {
    share = await SharedChat.findOneAndUpdate(
      { chatId: chat._id, userId: req.tokenData.id },
      {
        $setOnInsert: {
          token: crypto.randomBytes(32).toString("hex"),
          title: chat.topic,
          messages,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
    share = await SharedChat.findOne({
      chatId: chat._id,
      userId: req.tokenData.id,
    });
  }
  res.json({
    token: share.token,
    title: share.title,
    createdAt: share.createdAt,
  });
}
export async function listShares(req, res) {
  const shares = await SharedChat.find({ userId: req.tokenData.id })
    .select("token title chatId createdAt -_id")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ shares });
}
export async function revokeShare(req, res) {
  await SharedChat.deleteOne({
    token: req.params.token,
    userId: req.tokenData.id,
  });
  res.json({ success: true });
}
export async function readShare(req, res) {
  res.set({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  });
  if (!/^[a-f0-9]{64}$/.test(req.params.token))
    return res
      .status(404)
      .json({ message: "This share link is unavailable or has been revoked." });
  const share = await SharedChat.findOne({ token: req.params.token }).lean();
  if (
    !share ||
    !(await Chat.exists({ _id: share.chatId, userId: share.userId }))
  )
    return res
      .status(404)
      .json({ message: "This share link is unavailable or has been revoked." });
  res.json({
    title: share.title,
    messages: share.messages,
    createdAt: share.createdAt,
  });
}
