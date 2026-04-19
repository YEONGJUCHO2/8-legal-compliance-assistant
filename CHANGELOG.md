# Changelog

All notable changes to this project are documented here. The format loosely
follows Keep a Changelog; dates are in ISO 8601.

## [Unreleased]

### Added
- Production deploy configuration: `vercel.json` (regions=icn1, per-route Node runtime + maxDuration), `.github/workflows/ci.yml` (typecheck/lint/test/build/e2e matrix), `.env.production.example`, `docker-compose.yml` for local Postgres.
- Security headers in `next.config.ts`: HSTS, X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy, Permissions-Policy, Content-Security-Policy, `poweredByHeader: false`.
- Documentation: `README.md`, `DEPLOY.md`, `OPERATIONS.md`, `SHIP_CHECKLIST.md`, `CHANGELOG.md`.
- Phase 10 regression suites: 6 suite files (`pg-11-backpressure`, `pg-09-10-identity-fuzz`, `uf-16-17-date-parser`, `pg-03-schema-retry`, `verification-parallelism`, `malicious-corpus`), 8 injection payload fixtures, deterministic engine/MCP helpers, zod-validated wedge gold schema.
- `createEchoEngineAdapter()` helper for testing that the structured-envelope invariant survives LLMs that echo citation text verbatim.
- Memory-storage polyfill in `tests/setup.ts` so Node-environment tests can import UI code without hitting jsdom gaps; storage cleared in `afterEach` to prevent cross-test pollution.

### Changed
- Wedge gold items now carry `lawyerVerified: boolean` (all `false` pre-review). Zod schema in `tests/unit/wedge-gold.test.ts` enforces the field and pins verified count at zero until expansion.
- `malicious-corpus` regression: previously asserted payload strings were absent from answers (wrong security property — a faithful LLM quotation is not a leak). Now asserts structured-envelope preservation via `REGRESSION_ALLOWED_KINDS` and shape checks on the answer object.
- `pg-09-10-identity-fuzz` cross-user replay rewritten to exercise the real store API rather than a tautological comparison.

### Fixed
- `createRegressionDeps` silently overwriting caller-supplied `authStore` / `historyStore` overrides (the post-spread reassignment ran after the override was already applied).

### Security
- Production `AssistantDeps` remain fail-closed when any of `DATABASE_URL`, `SMTP_URL`, `AUTH_FROM_EMAIL`, `KOREAN_LAW_MCP_URL`, `ANTHROPIC_API_KEY` are missing. No silent dev-stub boot in production.
- Magic-link bearer tokens redacted from all logs (`src/lib/auth/email.ts`, `src/lib/auth/magic-link.ts`).
- `/api/metrics` gated by `METRICS_ACCESS_TOKEN` (403 without token).
- `/api/export` enforces verification/redaction before export to prevent bypass.

### Known gaps (tracked in SHIP_CHECKLIST.md)
- Real-environment smoke (live Postgres, Anthropic, `korean-law-mcp`, SMTP) pending external credentials.
- `evals/retrieval/wedge-gold.json` is 8 placeholder items; lawyer-graded 200+ set is a post-MVP milestone.
- Phase 02b bake-off decision is provisional; Top-1 / Top-3 / wrong-law gates not yet measured on a real gold set.
