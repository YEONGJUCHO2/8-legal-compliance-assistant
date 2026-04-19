CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() ships as STABLE because its dictionary is configurable, which blocks
-- its use in functional indexes. Wrap it in an IMMUTABLE SQL function pinned to
-- the default dictionary so GIN/BTREE indexes can reference it.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
  AS $$ SELECT unaccent('unaccent'::regdictionary, $1) $$;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_identities (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ,
  UNIQUE (provider, provider_subject)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  ip INET,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  email CITEXT NOT NULL,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip INET,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS engine_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id),
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','codex')),
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS law_documents (
  id UUID PRIMARY KEY,
  mst TEXT,
  law_id TEXT,
  title TEXT NOT NULL,
  short_title TEXT,
  promulgation_date DATE,
  enforcement_date DATE,
  source_url TEXT,
  fetched_at TIMESTAMPTZ,
  snapshot_hash TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS law_articles (
  id UUID PRIMARY KEY,
  law_id UUID NOT NULL REFERENCES law_documents(id),
  article_no TEXT NOT NULL,
  paragraph TEXT,
  item TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('article','paragraph','item','appendix')),
  title TEXT,
  body TEXT NOT NULL,
  effective_from DATE,
  effective_to DATE,
  UNIQUE (law_id, article_no, paragraph, item, kind, effective_from)
);

CREATE TABLE IF NOT EXISTS law_article_versions (
  id UUID PRIMARY KEY,
  article_id UUID NOT NULL REFERENCES law_articles(id),
  effective_from DATE NOT NULL,
  effective_to DATE,
  body TEXT NOT NULL,
  change_type TEXT
);

CREATE TABLE IF NOT EXISTS assistant_runs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_users(id),
  client_request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('clarify','answer','no_match','schema_error','verification_pending','error')),
  question TEXT NOT NULL,
  effective_date DATE NOT NULL,
  engine_session_id UUID REFERENCES engine_sessions(id),
  engine_provider TEXT,
  answer_strength TEXT CHECK (answer_strength IN ('confident','likely','inconclusive') OR answer_strength IS NULL),
  schema_retry_count SMALLINT NOT NULL DEFAULT 0,
  behavior_version TEXT NOT NULL,
  snapshot_hashes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  verification_state TEXT NOT NULL CHECK (verification_state IN ('verified','verification_pending','mcp_disagreement','degraded','unverified')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS assistant_run_citations (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
  law_id UUID REFERENCES law_documents(id),
  article_id UUID REFERENCES law_articles(id),
  cited_as TEXT NOT NULL,
  snapshot_hash TEXT,
  verified_at TIMESTAMPTZ,
  verification_result TEXT
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES assistant_runs(id),
  user_id UUID NOT NULL REFERENCES app_users(id),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_updates (
  id UUID PRIMARY KEY,
  effective_date DATE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  behavior_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_law_articles_body_tsv
  ON law_articles
  USING gin (to_tsvector('simple', immutable_unaccent(body)));

CREATE INDEX IF NOT EXISTS ix_law_articles_body_trgm
  ON law_articles
  USING gin (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_law_articles_effective_window
  ON law_articles (effective_from, effective_to);

CREATE INDEX IF NOT EXISTS ix_law_article_versions_article_effective_from
  ON law_article_versions (article_id, effective_from);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_expires_active
  ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_engine_sessions_expires_active
  ON engine_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_engine_sessions_user_provider
  ON engine_sessions (user_id, provider);

CREATE INDEX IF NOT EXISTS ix_auth_magic_links_token_hash
  ON auth_magic_links (token_hash);

CREATE INDEX IF NOT EXISTS ix_auth_magic_links_expires_unconsumed
  ON auth_magic_links (expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_assistant_runs_payload_hash
  ON assistant_runs (payload_hash);

CREATE INDEX IF NOT EXISTS ix_assistant_runs_user_created_at_desc
  ON assistant_runs (user_id, created_at DESC);
