ALTER TABLE auth_magic_links
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '';

ALTER TABLE auth_magic_links
  ADD COLUMN IF NOT EXISTS redemption_attempts INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS service_updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  behavior_version TEXT NOT NULL,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'service_updates'
      AND column_name = 'id'
      AND udt_name <> 'text'
  ) THEN
    ALTER TABLE service_updates
      ALTER COLUMN id TYPE TEXT USING id::text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_service_updates_effective_date
  ON service_updates (effective_date DESC);
