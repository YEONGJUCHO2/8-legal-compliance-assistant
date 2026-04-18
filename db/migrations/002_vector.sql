-- Phase 02b 결정 전까지 실행 금지
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE law_articles
  ADD COLUMN IF NOT EXISTS embedding vector(768);

ALTER TABLE law_articles
  ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;

CREATE INDEX IF NOT EXISTS ix_law_articles_embedding_hnsw
  ON law_articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
