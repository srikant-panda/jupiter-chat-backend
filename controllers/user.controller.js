import Message from "../models/message.model.js";
import Chat from "../models/chat.model.js";
import User from "../models/user.model.js";
import Session from "../models/auth.model.js";
import SharedChat from "../models/sharedChat.model.js";
import { getCookieOptions } from "../utils/jwtAndCookie.utils.js";
import { profileSchema } from "../validators/profile.schema.js";
import { normalizeAvatar } from "../services/avatar.service.js";

const publicProfile = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar || "",
  personalization: user.personalization || "",
  usage: user.usage,
  admin: user.admin === true,
});
export const getMe = async (req, res) =>
  res.json({ data: publicProfile(req.user) });
export async function updateProfile(req, res) {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: parsed.error.issues[0].message });
  const values = parsed.data;
  if (values.avatar !== undefined) {
    try {
      values.avatar = await normalizeAvatar(values.avatar);
    } catch {
      return res
        .status(400)
        .json({
          message:
            "Upload a valid PNG, JPEG or WebP image under 600 KB (maximum 16 megapixels).",
        });
    }
  }
  const user = await User.findByIdAndUpdate(
    req.tokenData.id,
    { $set: values },
    { returnDocument: "after", runValidators: true },
  );
  if (!user) return res.status(404).json({ message: "User not found." });
  res.json({ success: true, data: publicProfile(user) });
}
export const deleteUser = async (req, res) => {
  const userId = req.tokenData.id;
  await SharedChat.deleteMany({ userId });
  await Session.deleteMany({ owner: userId });
  await Message.deleteMany({ userId });
  await Chat.deleteMany({ userId });
  await User.findByIdAndDelete(userId);
  res.clearCookie("refreshToken", getCookieOptions(req));
  res.json({ success: true, message: "Account deleted." });
};
