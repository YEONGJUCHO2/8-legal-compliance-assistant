import { engineOutputSchemas, type EngineSchemaRef } from "@/lib/assistant/schemas";

import type { EnginePrompt, EngineResponse } from "./types";

const SCHEMA_RETRY_HINT =
  "Previous response violated the required JSON schema. Retry now and output only valid JSON that satisfies the declared schema.";

function withSchemaRetryHint(prompt: EnginePrompt): EnginePrompt {
  return {
    ...prompt,
    system: `${prompt.system}\n\n${SCHEMA_RETRY_HINT}`
  };
}

function parseStructuredOutput(schemaRef: EngineSchemaRef, rawText: string): EngineResponse | undefined {
  try {
    const parsedJson = JSON.parse(rawText) as unknown;

    return engineOutputSchemas[schemaRef].parse(parsedJson) as EngineResponse;
  } catch {
    return undefined;
  }
}

export async function generateAnswer({
  prompt,
  schemaRef,
  request
}: {
  prompt: EnginePrompt;
  schemaRef: EngineSchemaRef;
  request: (prompt: EnginePrompt, attempt: number) => Promise<string>;
}): Promise<{
  response: EngineResponse;
  schemaRetries: number;
}> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const attemptPrompt = attempt === 0 ? prompt : withSchemaRetryHint(prompt);
    const rawText = await request(attemptPrompt, attempt);
    const response = parseStructuredOutput(schemaRef, rawText);

    if (response) {
      return {
        response,
        schemaRetries: attempt
      };
    }
  }

  return {
    response: {
      type: "schema_error",
      message: "Engine response did not satisfy the required schema after one retry.",
      schema_retry_count: 2
    },
    schemaRetries: 2
  };
}

export { SCHEMA_RETRY_HINT };
