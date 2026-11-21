import User from "../models/user.model.js";
export const resetTokenUsageIfNeeded = async (user) => {
  const updated = await User.findOneAndUpdate(
    { _id: user._id, "usage.resetAt": { $lte: new Date() } },
    {
      $set: {
        "usage.tokenUsed": 0,
        "usage.resetAt": new Date(Date.now() + 5 * 60 * 60 * 1000),
      },
    },
    { returnDocument: "after" },
  );
  if (updated) user.usage = updated.usage;
};
export const isUsageLimitExceeded = (user) =>
  user.usage.tokenUsed >= user.usage.tokenLimit;
export const updateUserTokenUsage = async (user, usage) => {
  const total = usage?.totalTokens || 0;
  await User.updateOne(
    { _id: user._id },
    { $inc: { "usage.tokenUsed": total, "usage.totalTokenUsed": total } },
  );
  return true;
};
