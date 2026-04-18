CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key TEXT PRIMARY KEY,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_idempotency_records_expires_at
  ON idempotency_records (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS rerun_from_run_id UUID REFERENCES assistant_runs(id);

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS normalized_query TEXT NOT NULL DEFAULT '';

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS clarification_question TEXT;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS conclusion TEXT;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS explanation TEXT;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS caution TEXT;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS changed_since_created BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS reference_date_confirmed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS response_json JSONB;

ALTER TABLE assistant_runs
  ALTER COLUMN client_request_id DROP NOT NULL;

ALTER TABLE assistant_runs
  ALTER COLUMN payload_hash SET DEFAULT '';

ALTER TABLE assistant_runs
  ALTER COLUMN idempotency_expires_at SET DEFAULT now();

ALTER TABLE assistant_runs
  ALTER COLUMN verification_state SET DEFAULT 'unverified';

ALTER TABLE assistant_runs
  DROP CONSTRAINT IF EXISTS assistant_runs_status_check;

ALTER TABLE assistant_runs
  ADD CONSTRAINT assistant_runs_status_check
  CHECK (status IN ('clarify', 'answered', 'verification_pending', 'no_match', 'schema_error', 'engine_error', 'canceled'));

ALTER TABLE assistant_runs
  DROP CONSTRAINT IF EXISTS assistant_runs_answer_strength_check;

ALTER TABLE assistant_runs
  ADD CONSTRAINT assistant_runs_answer_strength_check
  CHECK (answer_strength IN ('clear', 'conditional', 'verification_pending') OR answer_strength IS NULL);

ALTER TABLE assistant_run_citations
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS article_version_id TEXT;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS verification_source TEXT NOT NULL DEFAULT 'local';

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS mcp_disagreement BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS latest_article_version_id TEXT;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS changed_summary TEXT;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ;

ALTER TABLE assistant_run_citations
  DROP CONSTRAINT IF EXISTS assistant_run_citations_verification_source_check;

ALTER TABLE assistant_run_citations
  ADD CONSTRAINT assistant_run_citations_verification_source_check
  CHECK (verification_source IN ('local', 'mcp'));
