import { z } from "zod";
export const messageRequest = z
  .object({
    content: z.string().trim().min(1).max(30000),
    model: z.string().trim().min(1).max(200).nullable().optional(),
    temporary: z.boolean().optional().default(false),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(30000),
          })
          .strict(),
      )
      .max(100)
      .optional()
      .default([]),
  })
  .strict()
  .refine(
    (data) =>
      data.history.reduce((sum, m) => sum + m.content.length, 0) <= 150000,
    "Temporary conversation is too long; start a new chat.",
  );
