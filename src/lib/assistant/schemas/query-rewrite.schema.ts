import { z } from "zod";

export const QueryRewriteSchema = z
  .object({
    legal_terms: z.array(z.string().min(1)).min(1).max(8),
    law_hints: z.array(z.string().min(1)).max(3),
    article_hints: z.array(z.string().min(1)).max(3),
    intent_summary: z.string().min(1).max(200)
  })
  .strict();

export type QueryRewriteOutput = z.infer<typeof QueryRewriteSchema>;
