import type {
  AnswerModuleOutput,
  ClarifyOutput,
  EngineSchemaRef,
  EngineSchemaRefs,
  NoMatchOutput,
  SchemaErrorOutput,
  VerificationPendingOutput
} from "@/lib/assistant/schemas";

export type EngineProvider = "anthropic" | "codex";
export type ClarifyModuleOutput = ClarifyOutput;
export type EngineResponse =
  | AnswerModuleOutput
  | ClarifyOutput
  | NoMatchOutput
  | SchemaErrorOutput
  | VerificationPendingOutput;

export interface CitationBlock {
  id: string;
  lawTitle: string;
  articleNo: string;
  paragraph?: string;
  item?: string;
  snapshotHash: string;
  body: string;
}

export interface EnginePrompt {
  system: string;
  user: string;
  citations: CitationBlock[];
  referenceDate: string;
  schemaRef: EngineSchemaRef;
}

export interface GenerateInput {
  sessionId?: string;
  userId: string;
  prompt: EnginePrompt;
  schemaRef: keyof EngineSchemaRefs;
}

export interface GenerateOutput {
  sessionId: string;
  response: EngineResponse;
  schemaRetries: number;
}

export interface EngineAdapter {
  provider: EngineProvider;
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

export type {
  AnswerModuleOutput,
  ClarifyOutput,
  EngineSchemaRef,
  NoMatchOutput,
  SchemaErrorOutput,
  VerificationPendingOutput
};
