export type UUID = string;
export type ISODate = string;
export type ISODateTime = string;
export type JsonSchema = Record<string, unknown>;

export type EngineProvider = "codex" | "anthropic";
export type AnswerStrength = "clear" | "conditional" | "verification_pending";

export interface Citation {
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
  verification_source: "local" | "mcp" | "missing";
  rendered_from_verification?: boolean;
  mcp_disagreement?: boolean;
  answer_strength_downgrade?: "conditional" | "verification_pending";
  latest_article_version_id?: UUID | null;
  changed_summary?: string | null;
}

export interface UsersRow {
  id: UUID;
  email: string;
  employee_number: string | null;
  auth_provider: "magic_link" | "oidc" | "saml";
  external_subject: string | null;
  organization_id: string | null;
  is_active: boolean;
  created_at: ISODateTime;
}

export interface SessionRow {
  id: UUID;
  user_id: UUID;
  session_token_hash: string;
  expires_at: ISODateTime;
  created_at: ISODateTime;
}

export interface UserIdentityRow {
  id: UUID;
  user_id: UUID;
  provider: "magic_link" | "oidc" | "saml";
  provider_subject: string;
  email_snapshot: string | null;
  employee_number_snapshot: string | null;
  organization_id: string | null;
  created_at: ISODateTime;
}

export interface EngineSessionRow {
  id: UUID;
  user_id: UUID;
  provider: EngineProvider;
  handle: string;
  created_at: ISODateTime;
  expires_at: ISODateTime;
  revoked_at: ISODateTime | null;
}

export interface LawsRow {
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
}

export interface LawArticleRow {
  id: UUID;
  document_id: UUID;
  kind: "article" | "appendix";
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
  embedding_model_version: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface ArticleVersionRow {
  id: UUID;
  article_id: UUID;
  version: number;
  article_text: string;
  effective_from: ISODate;
  effective_to: ISODate | null;
  repealed_at: ISODate | null;
  content_hash: string;
  created_at: ISODateTime;
}

export interface AppendixRow {
  article_id: UUID;
  document_id: UUID;
  label: string;
  title: string;
  body_markdown: string;
  effective_from: ISODate;
  effective_to: ISODate | null;
  content_hash: string;
}

export interface QuestionHistoryRow {
  id: UUID;
  user_id: UUID;
  rerun_from_run_id: UUID | null;
  client_request_id: string | null;
  user_query: string;
  normalized_query: string;
  query_effective_date: ISODate;
  status:
    | "clarify"
    | "answered"
    | "verification_pending"
    | "no_match"
    | "schema_error"
    | "engine_error"
    | "canceled";
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
}

export interface FeedbackEventRow {
  id: number;
  run_id: UUID;
  user_id: UUID;
  feedback_type: "helpful" | "wrong_citation" | "wrong_conclusion";
  created_at: ISODateTime;
}

export interface QuestionHistoryCitationRow {
  id: number;
  run_id: UUID;
  article_id: UUID;
  article_version_id: UUID;
  quote: string;
  position: number;
  verified_at_mcp: ISODateTime | null;
  verification_source: "local" | "mcp";
  mcp_disagreement: boolean;
  latest_article_version_id: UUID | null;
  changed_summary: string | null;
  changed_at: ISODateTime | null;
}

export interface ObservabilityLogEvent {
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
  citations?: Array<Pick<Citation, "article_id" | "article_version_id" | "verification_source">>;
  strength?: AnswerStrength | null;
  engine_provider?: EngineProvider;
  engine_latency_ms?: number;
  schema_retries?: number;
  stage_budget_burn_ms?: Partial<Record<"retrieval" | "generation" | "verification", number>>;
  verification_concurrency?: {
    in_flight: number;
    cap: number;
  };
  schema_retry_exhausted?: boolean;
  verification_state?: "verified" | "conditional" | "verification_pending";
  behavior_version?: string;
  rate_limit_state?: "allowed" | "rejected";
  route_max_duration_ms?: number;
  error_code?: string;
  created_at: ISODateTime;
}
