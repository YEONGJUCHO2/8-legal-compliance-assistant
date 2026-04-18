import { z } from "zod";

export const lawSectionSchema = z
  .object({
    law_title: z.string().min(1),
    summary: z.string().min(1),
    why_it_applies: z.string().min(1).optional(),
    check_first: z.array(z.string().min(1)).optional()
  })
  .strict();

export const answerModuleOutputSchema = z
  .object({
    verified_facts: z.array(z.string().min(1)),
    conclusion: z.string().min(1),
    explanation: z.string().min(1),
    caution: z.string().min(1),
    answered_scope: z.array(z.string().min(1)).optional(),
    unanswered_scope: z.array(z.string().min(1)).optional(),
    priority_order: z.array(z.string().min(1)).optional(),
    collapsed_law_summary: z.string().min(1).optional(),
    law_sections: z.array(lawSectionSchema).optional()
  })
  .strict();

export type AnswerModuleOutput = z.infer<typeof answerModuleOutputSchema>;
export type LawSection = z.infer<typeof lawSectionSchema>;
