# Phase 2 — DB Schema

## Goal
Define the PostgreSQL persistence model that all later phases depend on: users, auth sessions, magic-link issuance, engine-session handles, law content, article versions, history, feedback, service updates, and observability metadata. This phase also establishes the base migration runner and indexes, while keeping pgvector/HNSW in a separate Phase 02b-conditional migration.

## Scope
### In scope
- PostgreSQL extensions and migration framework
- Core tables for users, sessions, magic-link issuance, engine handles, laws, articles, versions, history, feedback, and service updates
- Base lexical/idempotency indexes plus a conditional vector migration path
- Idempotency and history indexes
- Migration contract tests

### Out of scope (deferred)
- Actual data ingestion jobs -> deferred to Phase 3
- Runtime verification logic -> deferred to Phase 6
- Auth email delivery and login UI -> deferred to Phase 8

## Dependencies
- Requires: Phase 1 (project skeleton, env loading, test harness)
- Depends on contracts: `UsersRow`, `SessionRow`, `UserIdentityRow`, `EngineSessionRow`, `LawsRow`, `LawArticleRow`, `ArticleVersionRow`, `QuestionHistoryRow`, `FeedbackEventRow`, `ObservabilityLogEvent`
- Depends on invariants: `PG-05 Auth-Scoped History Guard`, `PG-10 Identity Continuity Safety`, `UF-13 Idempotent Duplicate Submit`, `UF-23 Answer-Behavior Version Persistence`, `UF-26 Snapshot Change Disclosure`

## Steps
- [ ] Step 1: Create the migration directory and runner
  - Notes: add `db/migrations/` and `scripts/migrate.ts`; the runner should apply ordered SQL files exactly once and record them in `schema_migrations`. Reserve `001_base.sql` for the non-vector schema and `002_vector.sql` for the optional vector path.
- [ ] Step 2: Enable required PostgreSQL extensions
  - Notes: activate `pg_trgm`, `unaccent`, and `pgcrypto` in the base schema; `vector` is deferred to a later conditional migration that runs only if Phase 02b selects the local-index path.
- [ ] Step 3: Create identity and session tables
  - Notes: model `app_users`, `user_identities`, `auth_sessions`, `auth_magic_links(token_hash, email, created_at, expires_at, consumed_at, ip, user_agent)`, and `engine_sessions(id UUID PK, user_id UUID FK app_users NOT NULL, provider TEXT NOT NULL CHECK provider IN ('anthropic', 'codex'), handle TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ NULL)`. Preserve a stable internal `user_id` that survives later auth-provider changes; binding `engine_sessions.user_id` is the PG-09 compliance mechanism.
- [ ] Step 4: Create law-content tables
  - Notes: model `law_documents`, `law_articles`, and `law_article_versions`; represent appendices through article records with `kind = 'appendix'` or an equivalent logical view; keep base schema columns free of vector-specific assumptions and reserve `embedding` plus `embedding_model_version` for the optional vector migration only.
- [ ] Step 5: Create question-history and citation tables
  - Notes: add `assistant_runs` and `assistant_run_citations`; include status, effective date, behavior version, schema retry count, and change-tracking columns. Persist enough idempotency metadata (`client_request_id`, payload hash, and 24h expiry via the run row or a sibling ledger) for Phase 7 to reject payload drift deterministically.
- [ ] Step 6: Add feedback and service-update persistence
  - Notes: create `feedback_events` and `service_updates`; reserve the service-update table for dated behavior-change summaries shown to users later.
- [ ] Step 7: Add search, effective-date, and idempotency indexes
  - Notes: include GIN indexes for lexical search, effective-date indexes, auth-session expiry indexes, `engine_sessions(user_id, provider)` lookup support, an `(expires_at)` partial index where `revoked_at IS NULL`, token-hash and expiry indexes for `auth_magic_links`, and `(user_id, client_request_id)` uniqueness plus payload-hash lookup for duplicate-submit protection.
- [ ] Step 8: Add the conditional vector migration
  - Notes: create `002_vector.sql` as the separate migration that enables `vector`, adds embedding columns plus `embedding_model_version TEXT NOT NULL` where needed, and builds HNSW indexes only if Phase 02b selects the local-index strategy; migration ordering is `001_base.sql` first, `002_vector.sql` second, never the reverse. Phase 3 ingestion must detect whether the vector columns exist before it attempts embedding work.
- [ ] Step 9: Write migration contract tests
  - Notes: verify the critical tables, columns, check constraints, base indexes, and the conditional vector migration guard exist without asserting the entire raw SQL file as a fixture.

## Test plan
- Unit: migration contract checks for table names, status enums, answer-strength enums, `engine_sessions` presence, magic-link tables, partial expiry indexes, and idempotency uniqueness.
- Integration: run base migrations against a local database from a clean state and re-run to prove idempotence; if local-index is selected later, apply the vector migration as a separate second pass.
- E2E (if UI/E2E relevant): none.
- Evals (if LLM-affecting): none.

## Done when
- [ ] A clean database can be migrated forward without manual steps
- [ ] The schema supports users, magic-link issuance, session continuity, server-owned engine handles, law versioning, history snapshots, feedback, and behavior-version logging
- [ ] Base search and idempotency indexes exist, and the `001_base.sql` / `002_vector.sql` split remains explicitly Phase 02b-conditional
- [ ] All invariants from Dependencies section verified
