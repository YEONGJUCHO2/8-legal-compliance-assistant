# Changelog

All notable changes to this project are documented here. The format loosely
follows Keep a Changelog; dates are in ISO 8601.

## [Unreleased]

### Added
- **Librarian query-rewrite hop** (`src/lib/assistant/query-rewrite.ts`, `schemas/query-rewrite.schema.ts`, migration `007_assistant_runs_query_rewrite.sql`). Before retrieval runs, Codex rewrites the user's natural-language question into statute-facing legal terms (`legal_terms`, `law_hints`, `article_hints`, `intent_summary`). Field slang like 공구리 / 족장 / 신나통 / 안전띠 / 곤도라 now reaches the right statute ("제331조의2 거푸집 조립 시의 안전조치", 비계 규칙, etc.) via LLM translation — no hardcoded synonym table.
- **Candidate cap** `RETRIEVAL_CANDIDATE_CAP` (default 5) threaded through retrieval + MCP verification so the 60s Vercel function budget holds even on longer codex latency.
- **Production deployment** on Vercel at https://8-legal-compliance-assistant.vercel.app (yeongjucho2 scope), Neon Postgres backing store (6 MVP laws / 6,319 articles / 6,357 versions loaded), Codex daemon + korean-law-mcp exposed over Tailscale Funnel, Gmail SMTP for magic links.
- Production deploy configuration: `vercel.json` (regions=icn1, per-route Node runtime + maxDuration), `.env.production.example`, `docker-compose.yml` for local Postgres, CI workflow YAML inlined into `SHIP_CHECKLIST.md` §2.4 (operator applies with a `workflow`-scoped token).
- Security headers in `next.config.ts`: HSTS, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy, Content-Security-Policy, `poweredByHeader: false`.
- `POST /api/auth/logout` route — revokes the session row matching the current `app_session` cookie and clears the cookie. Idempotent on missing or mismatched tokens.
- `postLogout()` api-client helper and a 로그아웃 button in `AppShell` hero row with fallback navigation to `/login` on failure.
- Session `tokenHash` uniqueness enforcement across both stores; migration `006_auth_sessions_token_hash_unique.sql` guards the PG side.
- `detectSuspiciousDateHint()` now flags `어제`, `최근`, `요즘` as `relative_past_hint`.
- In-memory rate-limit `consume()` fast-path for atomic read-modify-write — concurrent 2N requests against N-capacity bucket now split exactly N allowed / N blocked.
- Documentation: `README.md`, `DEPLOY.md`, `OPERATIONS.md`, `SHIP_CHECKLIST.md`, `CHANGELOG.md`.
- Phase 10 regression suites: 6 suite files (`pg-11-backpressure`, `pg-09-10-identity-fuzz`, `uf-16-17-date-parser`, `pg-03-schema-retry`, `verification-parallelism`, `malicious-corpus`), 8 injection payload fixtures, deterministic engine/MCP helpers, zod-validated wedge gold schema.
- `createEchoEngineAdapter()` helper for testing that the structured-envelope invariant survives LLMs that echo citation text verbatim.
- Memory-storage polyfill in `tests/setup.ts` so Node-environment tests can import UI code without hitting jsdom gaps; storage cleared in `afterEach` to prevent cross-test pollution.

### Changed
- `/api/metrics` token comparison uses `crypto.timingSafeEqual` — no more direct `!==` that leaks comparison duration.
- Wedge gold items now carry `lawyerVerified: boolean` (all `false` pre-review). Zod schema in `tests/unit/wedge-gold.test.ts` enforces the field and pins verified count at zero until expansion.
- `malicious-corpus` regression: previously asserted payload strings were absent from answers (wrong security property — a faithful LLM quotation is not a leak). Now asserts structured-envelope preservation via `REGRESSION_ALLOWED_KINDS` and shape checks on the answer object.
- `pg-09-10-identity-fuzz` cross-user replay rewritten to exercise the real store API rather than a tautological comparison.

### Fixed
- `createRegressionDeps` silently overwriting caller-supplied `authStore` / `historyStore` overrides (the post-spread reassignment ran after the override was already applied).

### Security
- Production `AssistantDeps` remain fail-closed when any of `DATABASE_URL`, `SMTP_URL`, `AUTH_FROM_EMAIL`, `KOREAN_LAW_MCP_URL`, `ANTHROPIC_API_KEY` are missing. No silent dev-stub boot in production.
- Magic-link bearer tokens redacted from all logs (`src/lib/auth/email.ts`, `src/lib/auth/magic-link.ts`).
- `/api/metrics` gated by `METRICS_ACCESS_TOKEN` (403 without token, constant-time comparison).
- `/api/export` enforces verification/redaction before export to prevent bypass.
- `auth_sessions.token_hash` is now UNIQUE at both the application layer and the Postgres schema (migration 006). Collisions raise `AuthError("session_conflict")`.
- `npm audit --omit=dev` reports 0 vulnerabilities on commit `aa8fff7`.

### Known gaps (tracked in SHIP_CHECKLIST.md)
- Real-environment smoke (live Postgres, Anthropic, `korean-law-mcp`, SMTP) pending external credentials.
- `evals/retrieval/wedge-gold.json` is 8 placeholder items; lawyer-graded 200+ set is a post-MVP milestone.
- Phase 02b bake-off decision is provisional; Top-1 / Top-3 / wrong-law gates not yet measured on a real gold set.
- `.github/workflows/ci.yml` must be added by an operator with `workflow`-scope token (inline YAML in SHIP_CHECKLIST §2.4).
