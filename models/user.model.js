import mongoose from "mongoose";
import { maxLength, minLength } from "zod";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      minLength: 3,
      maxLength: 150,
      trim: true,
    },

    age: {
      type: Number,
    },

    email: {
      type: String,
      required: true,
      unique: true,
    },

    password: {
      type: String,
      default:null
    },
    admin: {
      type: Boolean,
      default: false,
    },
    method: {
      name: {
        type: String,
        enum: ["google", "github", "email"],
      }
    },

    usage: {
      tokenUsed: {
        type: Number,
        default: 0,
      },

      tokenLimit: {
        type: Number,
        default: 150000,
      },

      resetAt: {
        type: Date,
        default: () => new Date(Date.now() + 5 * 60 * 60 * 1000),
      },

      totalTokenUsed: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

export default User;
