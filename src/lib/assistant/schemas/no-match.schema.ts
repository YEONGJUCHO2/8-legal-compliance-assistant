import { z } from "zod";

export const noMatchOutputSchema = z
  .object({
    type: z.literal("no_match"),
    message: z.string().min(1),
    next_actions: z.array(z.string().min(1)).optional()
  })
  .strict();

export type NoMatchOutput = z.infer<typeof noMatchOutputSchema>;
