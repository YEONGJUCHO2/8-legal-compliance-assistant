# Contracts

This file extracts the shared interfaces, response envelopes, and schema shapes that the phase plans depend on. Names below are the canonical domain names; parenthetical notes show the concrete table or file names already present in the historical plan.

## Canonical Scalars

```ts
type UUID = string;
type ISODate = string; // YYYY-MM-DD
type ISODateTime = string; // RFC3339
type JsonSchema = Record<string, unknown>;
```

## Engine Adapter

```ts
type EngineSessionHandle = string; // Server-owned opaque handle bound to user_id; clients never see provider-native handles.

export interface EngineAdapter {
  generate<T>(params: {
    sessionId?: EngineSessionHandle;
    prompt: string;
    schema: JsonSchema;
  }): Promise<{
    sessionId: EngineSessionHandle;
    response: T;
  }>;
}
```

```ts
export type EngineProvider = 'codex' | 'anthropic';
```

## Engine Output Modules

The MVP engine call site is the answer generator. The other envelopes are still defined here because the pipeline and UI treat them as schema-governed module outputs and future engine-assisted variants should reuse the same shapes.

### `clarify`

```ts
export type ClarifyOutput = {
  type: 'clarify';
  question: string;
  reasonCode?:
    | 'missing_fact'
    | 'date_confirmation'
    | 'ambiguous_law'
    | 'low_confidence';
};
```

### `answer`

```ts
export type AnswerStrength = 'clear' | 'conditional' | 'verification_pending';

export type LawSection = {
  law_title: string;
  summary: string;
  why_it_applies?: string;
  check_first?: string[];
};

export type AnswerModuleOutput = {
  verified_facts: string[];
  conclusion: string;
  explanation: string;
  caution: string;
  answered_scope?: string[];
  unanswered_scope?: string[];
  priority_order?: string[];
  collapsed_law_summary?: string;
  law_sections?: LawSection[];
};
```

### `no_match`

```ts
export type NoMatchOutput = {
  type: 'no_match';
  message: string;
  next_actions?: string[];
};
```

### `schema_error`

```ts
export type SchemaErrorOutput = {
  type: 'schema_error';
  message: string;
  schema_retry_count: 2;
};
```

### `verification_pending`

```ts
export type VerificationPendingOutput = {
  type: 'verification_pending';
  message: string;
  export_locked: true;
  can_continue_viewing: true;
};
```

## Answer And Citation Contracts

```ts
export type Citation = {
  law_id: string | null;
  article_id: UUID;
  article_version_id: UUID;
  text: string;
  quote?: string;
  law_title: string;
  article_number: string;
  mcp_verified: boolean;
  verified_at: ISODateTime | null;
  in_force_at_query_date: boolean;
  verification_source: 'local' | 'mcp';
  rendered_from_verification?: boolean;
  mcp_disagreement?: boolean;
  latest_article_version_id?: UUID | null;
  changed_summary?: string | null;
};
```

```ts
export type AnswerResponse = {
  type: 'answer';
  session_id: EngineSessionHandle; // Server-owned opaque handle; if it crosses an API boundary it remains opaque transport metadata and must not drive browser-visible state.
  status: 'answered';
  strength: AnswerStrength;
  citations: Citation[];
  effective_date: ISODate;
  rendered_from: 'local_index' | 'mcp_verification' | 'mixed';
  behavior_version: string;
  generated_from_skip?: boolean;
  verified_facts: string[];
  conclusion: string;
  explanation: string;
  caution: string;
  answered_scope?: string[];
  unanswered_scope?: string[];
  priority_order?: string[];
  collapsed_law_summary?: string;
  law_sections?: LawSection[];
  changed_since_created?: boolean;
};
```

## Zod Or Schema Mirrors

These are shape-level mirrors, not full implementation files.

```ts
const AnswerModuleSchema = z.object({
  verified_facts: z.array(z.string().min(1)).default([]),
  conclusion: z.string().min(1),
  explanation: z.string().min(1),
  caution: z.string().min(1),
  answered_scope: z.array(z.string().min(1)).default([]).optional(),
  unanswered_scope: z.array(z.string().min(1)).default([]).optional(),
  priority_order: z.array(z.string().min(1)).default([]).optional(),
  collapsed_law_summary: z.string().optional(),
  law_sections: z
    .array(
      z.object({
        law_title: z.string().min(1),
        summary: z.string().min(1),
        why_it_applies: z.string().optional(),
        check_first: z.array(z.string().min(1)).default([]).optional(),
      }),
    )
    .max(6)
    .optional(),
});
```

```ts
const serverTodayISO = () => new Date().toISOString().slice(0, 10);

const AskRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ask'),
    query: z.string().min(1),
    effective_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => value <= serverTodayISO(), 'effective_date must be today or earlier'),
    client_request_id: z.string().uuid().optional(),
    reference_date_confirmed: z.boolean().optional(),
    skip_clarification: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal('rerun_current_law'),
    run_id: z.string().uuid(),
  }),
]);
```

## Database Contracts

The plan body uses concrete table names such as `app_users`, `auth_sessions`, `law_documents`, and `assistant_runs`. The logical names below are the cross-phase domain contracts.

### `users` (`app_users`)

```ts
type UsersRow = {
  id: UUID;
  email: string;
  employee_number: string | null;
  auth_provider: 'magic_link' | 'oidc' | 'saml';
  external_subject: string | null;
  organization_id: string | null;
  is_active: boolean;
  created_at: ISODateTime;
};
```

### `sessions` (`auth_sessions` + `user_identities`)

```ts
type SessionRow = {
  id: UUID;
  user_id: UUID;
  session_token_hash: string;
  expires_at: ISODateTime;
  created_at: ISODateTime;
};

type UserIdentityRow = {
  id: UUID;
  user_id: UUID;
  provider: 'magic_link' | 'oidc' | 'saml';
  provider_subject: string;
  email_snapshot: string | null;
  employee_number_snapshot: string | null;
  organization_id: string | null;
  created_at: ISODateTime;
};
```

### `laws` (`law_documents`)

```ts
type LawsRow = {
  id: UUID;
  law_mst: string;
  law_id: string | null;
  title: string;
  normalized_title: string;
  law_kind: string;
  ministry: string | null;
  promulgated_at: ISODate | null;
  source_url: string;
  body_markdown: string;
  source_hash: string;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};
```

### `law_articles` (`law_articles`)

```ts
type LawArticleRow = {
  id: UUID;
  document_id: UUID;
  kind: 'article' | 'appendix';
  law_title: string;
  article_number: string;
  article_heading: string;
  article_text: string;
  article_path: string;
  effective_from: ISODate;
  effective_to: ISODate | null;
  repealed_at: ISODate | null;
  content_hash: string;
  version: number;
  embedding: number[] | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};
```

### `article_versions` (`law_article_versions`)

```ts
type ArticleVersionRow = {
  id: UUID;
  article_id: UUID;
  version: number;
  article_text: string;
  effective_from: ISODate;
  effective_to: ISODate | null;
  repealed_at: ISODate | null;
  content_hash: string;
  created_at: ISODateTime;
};
```

Temporal selection rules for `ArticleVersionRow`:
- Repeal gap: if no version is in force on the requested date, retrieval must return no active article instead of backfilling from the nearest older text.
- Repealed then reinstated: reinstatement creates a new `ArticleVersionRow.version`; the resurrected text never mutates the older repealed row in place.
- Future-effective amendments: future text may be stored, but current-law retrieval excludes it until `effective_from` is reached.
- Fixtures for repeal-gap, reinstatement, and future-effective cases must remain part of the cross-phase regression corpus.

### `appendices` (logical view over `law_articles.kind = 'appendix'`)

```ts
type AppendixRow = {
  article_id: UUID;
  document_id: UUID;
  label: string;
  title: string;
  body_markdown: string;
  effective_from: ISODate;
  effective_to: ISODate | null;
  content_hash: string;
};
```

### `question_history` (`assistant_runs` + `assistant_run_citations`)

```ts
type QuestionHistoryRow = {
  id: UUID;
  user_id: UUID;
  rerun_from_run_id: UUID | null;
  client_request_id: string | null;
  user_query: string;
  normalized_query: string;
  query_effective_date: ISODate;
  status:
    | 'clarify'
    | 'answered'
    | 'no_match'
    | 'schema_error'
    | 'engine_error'
    | 'canceled';
  clarification_question: string | null;
  answer_strength: AnswerStrength | null;
  conclusion: string | null;
  explanation: string | null;
  caution: string | null;
  changed_since_created: boolean;
  answer_behavior_version: string;
  reference_date_confirmed: boolean;
  engine_provider: EngineProvider;
  schema_retry_count: number;
  created_at: ISODateTime;
};

type QuestionHistoryCitationRow = {
  id: number;
  run_id: UUID;
  article_id: UUID;
  article_version_id: UUID;
  quote: string;
  position: number;
  verified_at_mcp: ISODateTime | null;
  verification_source: 'local' | 'mcp';
  mcp_disagreement: boolean;
  latest_article_version_id: UUID | null;
  changed_summary: string | null;
  changed_at: ISODateTime | null;
};
```

### `feedback_events` (`feedback_events`)

```ts
type FeedbackEventRow = {
  id: number;
  run_id: UUID;
  user_id: UUID;
  feedback_type: 'helpful' | 'wrong_citation' | 'wrong_conclusion';
  created_at: ISODateTime;
};
```

### `observability_logs` (structured logs, not necessarily a DB table)

```ts
type ObservabilityLogEvent = {
  request_id: string;
  user_id: UUID | null;
  run_id?: UUID;
  query_effective_date?: ISODate;
  retrieval_scores?: Array<{
    article_id: UUID;
    lexical_score?: number;
    vector_score?: number;
    combined_score?: number;
  }>;
  citations?: Array<Pick<Citation, 'article_id' | 'article_version_id' | 'verification_source'>>;
  strength?: AnswerStrength | null;
  engine_provider?: EngineProvider;
  engine_latency_ms?: number;
  schema_retries?: number;
  verification_state?: 'verified' | 'conditional' | 'verification_pending';
  behavior_version?: string;
  rate_limit_state?: 'allowed' | 'rejected';
  error_code?: string;
  created_at: ISODateTime;
};
```

## API Envelopes

### `POST /api/ask`

```ts
type AskRequest =
  | {
      mode: 'ask';
      query: string;
      effective_date: ISODate;
      client_request_id?: string;
      reference_date_confirmed?: boolean;
      skip_clarification?: boolean;
    }
  | {
      mode: 'rerun_current_law';
      run_id: UUID;
    };

type AskResponse =
  | ClarifyOutput
  | AnswerResponse
  | NoMatchOutput
  | SchemaErrorOutput
  | {
      type: 'engine_error';
      message: string;
    }
  | {
      type: 'date_confirmation_required';
      message: string;
    };
```

If `session_id` is present on an API envelope, clients treat it as opaque transport metadata only. It is never rendered, user-editable, or a substitute for authenticated session state.

### `GET /api/history`

```ts
type HistoryListItem = {
  id: UUID;
  user_query: string;
  query_effective_date: ISODate;
  status: QuestionHistoryRow['status'];
  answer_strength: AnswerStrength | null;
  conclusion: string | null;
  clarification_question: string | null;
  changed_since_created: boolean;
  answer_behavior_version: string;
  created_at: ISODateTime;
};

type HistoryListResponse = {
  history: HistoryListItem[];
};
```

### `GET /api/history/:runId`

```ts
type HistorySnapshotResponse = {
  snapshot: QuestionHistoryRow & {
    citations: Citation[];
  };
};
```

### `POST /api/feedback`

Inferred from `feedback_events` and `feedback-buttons`.

```ts
type FeedbackRequest = {
  run_id: UUID;
  feedback_type: 'helpful' | 'wrong_citation' | 'wrong_conclusion';
};

type FeedbackResponse = {
  ok: true;
  recorded_at: ISODateTime;
};
```

### `POST /api/export`

Inferred from the export requirements and `src/lib/export/pdf.ts`.

```ts
type ExportRequest = {
  run_id: UUID;
  format: 'pdf' | 'clipboard' | 'print';
  variant: 'redaction_review' | 'full_text';
  confirm_redaction_review: boolean;
};

type ExportResponse = {
  ok: true;
  format: 'pdf' | 'clipboard' | 'print';
  variant: 'redaction_review' | 'full_text';
  effective_date: ISODate;
  requires_user_review: boolean;
  payload_url?: string;
  clipboard_text?: string;
  print_html?: string;
};
```

### `POST /api/answer-with-current-law`

The historical plan used `/api/ask` with `mode: 'rerun_current_law'`. This route contract is the equivalent explicit envelope for the same operation.

```ts
type AnswerWithCurrentLawRequest = {
  run_id: UUID;
};

type AnswerWithCurrentLawResponse = ClarifyOutput | AnswerResponse | NoMatchOutput | SchemaErrorOutput;
```

`effective_date` is the user-visible reference date and must be rejected if it is later than server `today`.

## `--output-schema` References

These are the canonical schema files passed to engine calls. Phase 5 owns the adapter wiring; later phases reuse the references.

```ts
const EngineSchemaRefs = {
  clarify: 'src/lib/assistant/schemas/clarify.output.schema.json',
  answer: 'src/lib/assistant/schemas/answer.output.schema.json',
  no_match: 'src/lib/assistant/schemas/no-match.output.schema.json',
  schema_error: 'src/lib/assistant/schemas/schema-error.output.schema.json',
  verification_pending: 'src/lib/assistant/schemas/verification-pending.output.schema.json',
} as const;
```

## Route-To-Schema Matrix

```ts
const EngineCallSites = [
  {
    module: 'answer',
    caller: 'src/lib/assistant/generate.ts',
    schema_ref: EngineSchemaRefs.answer,
  },
  {
    module: 'clarify',
    caller: 'reserved for future engine-assisted clarification',
    schema_ref: EngineSchemaRefs.clarify,
  },
  {
    module: 'verification_pending',
    caller: 'pipeline downgrade envelope after MCP verification',
    schema_ref: EngineSchemaRefs.verification_pending,
  },
];
```
