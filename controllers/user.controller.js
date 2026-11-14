import { Chat } from "openai/resources.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";

export const getMe = async (req, res) => {
  const { id: userId } = req.tokenData;
  const user = await User.findById(userId);
  if (!user)
    return res.status(404).json({ message: "User not found.", success: false });
  res.json({
    message: "User fetched successfully.",
    data: {
      id: user._id,
      name: user.name,
      email: user.email,
      usage: user.usage,
      admin: Boolean(user.admin === true || user.isAdmin === true),
    },
  });
};

export const deleteUser = async (req, res) => {
  try {
    const deleteMessages = await Message.deleteMany({ userId:req.tokenData.id });
    if(deleteMessages.deletedCount !== 0){
      const deleteChats = await Chat.deleteMany({ userID:req.tokenData.id });
      if(deleteChats.deletedCount !== 0){
        const deleteUser = await User.findByIdAndDelete(req.tokenData.id);

        res.clearCookie("refreshToken",{
          httpOnly:true,
          secure:false
        })
        res.json({
          message:"User deleted.",
          success:true
        })
      }
    }
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      message:"Internal server error"
    });
  }
};
