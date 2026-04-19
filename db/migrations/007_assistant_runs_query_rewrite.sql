ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS query_rewrite_terms JSONB,
  ADD COLUMN IF NOT EXISTS query_rewrite_intent TEXT;
