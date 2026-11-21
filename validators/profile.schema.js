import { z } from "zod";
export const profileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(3)
      .max(150)
      .refine(
        (v) => !/[\u0000-\u001f\u007f]/.test(v),
        "Name contains unsupported characters.",
      ),
    personalization: z.string().trim().max(4000),
    avatar: z.string().max(800000).optional(),
  })
  .strict();
