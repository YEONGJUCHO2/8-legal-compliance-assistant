import { z } from "zod";

export const clarifyOutputSchema = z
  .object({
    type: z.literal("clarify"),
    question: z.string().min(1),
    reasonCode: z.enum(["missing_fact", "date_confirmation", "ambiguous_law", "low_confidence"]).optional()
  })
  .strict();

export type ClarifyOutput = z.infer<typeof clarifyOutputSchema>;
