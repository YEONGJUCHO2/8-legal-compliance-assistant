import { z } from "zod";

export const verificationPendingOutputSchema = z
  .object({
    type: z.literal("verification_pending"),
    message: z.string().min(1),
    export_locked: z.literal(true),
    can_continue_viewing: z.literal(true)
  })
  .strict();

export type VerificationPendingOutput = z.infer<typeof verificationPendingOutputSchema>;
