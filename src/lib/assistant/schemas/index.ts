import { answerModuleOutputSchema } from "@/lib/assistant/schemas/answer.schema";
import { clarifyOutputSchema } from "@/lib/assistant/schemas/clarify.schema";
import { noMatchOutputSchema } from "@/lib/assistant/schemas/no-match.schema";
import { schemaErrorOutputSchema } from "@/lib/assistant/schemas/schema-error.schema";
import { verificationPendingOutputSchema } from "@/lib/assistant/schemas/verification-pending.schema";

export const EngineSchemaRefs = {
  clarify: "src/lib/assistant/schemas/clarify.output.schema.json",
  answer: "src/lib/assistant/schemas/answer.output.schema.json",
  no_match: "src/lib/assistant/schemas/no-match.output.schema.json",
  schema_error: "src/lib/assistant/schemas/schema-error.output.schema.json",
  verification_pending: "src/lib/assistant/schemas/verification-pending.output.schema.json"
} as const;

export type EngineSchemaRefs = typeof EngineSchemaRefs;
export type EngineSchemaRef = keyof EngineSchemaRefs;

export const engineOutputSchemas = {
  answer: answerModuleOutputSchema,
  clarify: clarifyOutputSchema,
  no_match: noMatchOutputSchema,
  schema_error: schemaErrorOutputSchema,
  verification_pending: verificationPendingOutputSchema
} as const;

export * from "@/lib/assistant/schemas/answer.schema";
export * from "@/lib/assistant/schemas/clarify.schema";
export * from "@/lib/assistant/schemas/no-match.schema";
export * from "@/lib/assistant/schemas/schema-error.schema";
export * from "@/lib/assistant/schemas/verification-pending.schema";
