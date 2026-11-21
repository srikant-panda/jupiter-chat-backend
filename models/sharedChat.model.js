import mongoose from "mongoose";
const sharedChatSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    messages: [
      {
        _id: false,
        role: { type: String, enum: ["user", "assistant"] },
        content: String,
      },
    ],
  },
  { timestamps: true },
);
export default mongoose.model("SharedChat", sharedChatSchema);
