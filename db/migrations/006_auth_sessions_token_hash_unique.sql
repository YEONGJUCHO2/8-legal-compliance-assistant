DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_sessions_token_hash_unique'
  ) THEN
    ALTER TABLE auth_sessions
    ADD CONSTRAINT auth_sessions_token_hash_unique UNIQUE (token_hash);
  END IF;
END $$;
