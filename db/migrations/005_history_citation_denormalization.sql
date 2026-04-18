ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS law_id UUID;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS law_title TEXT NOT NULL DEFAULT '';

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS article_number TEXT NOT NULL DEFAULT '';

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS in_force_at_query_date BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS answer_strength_downgrade TEXT;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS rendered_from_verification BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assistant_run_citations
  DROP CONSTRAINT IF EXISTS assistant_run_citations_answer_strength_downgrade_check;

ALTER TABLE assistant_run_citations
  ADD CONSTRAINT assistant_run_citations_answer_strength_downgrade_check
  CHECK (answer_strength_downgrade IN ('conditional', 'verification_pending') OR answer_strength_downgrade IS NULL);
