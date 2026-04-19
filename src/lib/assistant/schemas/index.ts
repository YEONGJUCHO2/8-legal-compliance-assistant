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

const nonEmptyStringSchema = {
  type: "string",
  minLength: 1
} as const;

const nullableNonEmptyStringSchema = {
  type: ["string", "null"],
  minLength: 1
} as const;

const stringArraySchema = {
  type: "array",
  items: nonEmptyStringSchema
} as const;

const nullableStringArraySchema = {
  type: ["array", "null"],
  items: nonEmptyStringSchema
} as const;

const lawSectionJsonSchema = {
  type: "object",
  properties: {
    law_title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema,
    why_it_applies: nullableNonEmptyStringSchema,
    check_first: nullableStringArraySchema
  },
  required: ["law_title", "summary", "why_it_applies", "check_first"],
  additionalProperties: false
} as const;

export const engineOutputJsonSchemas = {
  answer: {
    type: "object",
    properties: {
      verified_facts: stringArraySchema,
      conclusion: nonEmptyStringSchema,
      explanation: nonEmptyStringSchema,
      caution: nonEmptyStringSchema,
      answered_scope: nullableStringArraySchema,
      unanswered_scope: nullableStringArraySchema,
      priority_order: nullableStringArraySchema,
      collapsed_law_summary: nullableNonEmptyStringSchema,
      law_sections: {
        type: ["array", "null"],
        items: lawSectionJsonSchema
      }
    },
    required: [
      "verified_facts",
      "conclusion",
      "explanation",
      "caution",
      "answered_scope",
      "unanswered_scope",
      "priority_order",
      "collapsed_law_summary",
      "law_sections"
    ],
    additionalProperties: false
  },
  clarify: {
    type: "object",
    properties: {
      type: {
        const: "clarify"
      },
      question: nonEmptyStringSchema,
      reasonCode: nullableNonEmptyStringSchema
    },
    required: ["type", "question", "reasonCode"],
    additionalProperties: false
  },
  no_match: {
    type: "object",
    properties: {
      type: {
        const: "no_match"
      },
      message: nonEmptyStringSchema,
      next_actions: nullableStringArraySchema
    },
    required: ["type", "message", "next_actions"],
    additionalProperties: false
  },
  schema_error: {
    type: "object",
    properties: {
      type: {
        const: "schema_error"
      },
      message: nonEmptyStringSchema,
      schema_retry_count: {
        const: 2
      }
    },
    required: ["type", "message", "schema_retry_count"],
    additionalProperties: false
  },
  verification_pending: {
    type: "object",
    properties: {
      type: {
        const: "verification_pending"
      },
      message: nonEmptyStringSchema,
      export_locked: {
        const: true
      },
      can_continue_viewing: {
        const: true
      }
    },
    required: ["type", "message", "export_locked", "can_continue_viewing"],
    additionalProperties: false
  }
} as const;

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
