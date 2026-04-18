import { z } from "zod";

export const schemaErrorOutputSchema = z
  .object({
    type: z.literal("schema_error"),
    message: z.string().min(1),
    schema_retry_count: z.literal(2)
  })
  .strict();

export type SchemaErrorOutput = z.infer<typeof schemaErrorOutputSchema>;
