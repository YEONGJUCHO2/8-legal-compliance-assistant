# Deployment Runbook

Legal Compliance Assistant — Vercel + managed Postgres. Korean-law-mcp hosted separately.

## Prereqs

- Vercel account with project linked to this repo
- Managed Postgres 16 (Supabase / Neon / RDS) with `pgcrypto` extension
- `korean-law-mcp` REST service reachable over HTTPS (this repo ships `scripts/law-mcp-server.ts`)
- Local host (Mac mini or similar) to run `scripts/codex-daemon.ts` 24/7 via launchd, with `codex` CLI logged in
- SMTP provider account (SendGrid / Mailgun / SES) configured for magic-link delivery
- `open.law.go.kr` OpenAPI key

## First-time setup

1. **Provision Postgres**
   - Create database `legal_compliance`
   - Ensure `pgcrypto` extension: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
   - Note the connection string with `sslmode=require`

2. **Run migrations**
   ```bash
   DATABASE_URL="<prod-url>" npm run migrate
   ```
   Expected order: `001_base.sql` → `003_postgres_concrete_wiring.sql` → `004_runtime_state.sql` → `005_history_citation_denormalization.sql` → `006_session_token_hash_unique.sql` (if generated).
   - `002_vector.sql` is **opt-in** (pgvector). MVP does not use it; skip unless the bake-off revisit flips to local index.

3. **Seed law corpus**
   ```bash
   DATABASE_URL="<prod-url>" LAW_API_KEY="<key>" npx tsx scripts/sync-laws.ts
   ```
   Pulls the MVP 6-law cluster + 별표/별지 from `open.law.go.kr`. Re-run periodically for freshness — see `scripts/resync-flagged.ts` for targeted re-sync.

4. **Configure Vercel project secrets**
   Copy every key from `.env.production.example` to Vercel Project Settings → Environment Variables (Production scope):
   - `DATABASE_URL`, `LAW_API_KEY`, `KOREAN_LAW_MCP_URL`, `CODEX_DAEMON_URL`
   - `APP_BASE_URL`, `AUTH_SECRET` (64+ bytes random), `AUTH_FROM_EMAIL`, `SMTP_URL`
   - `METRICS_ACCESS_TOKEN` (rotate periodically)
   - `ENGINE_PROVIDER=codex`
   - Deadline budgets (defaults in example file are tuned for Vercel Node 60s maxDuration; note that the codex daemon smoke showed ~21s p50, so tighten ENGINE_DEADLINE_MS with the daemon's real latency in mind)
   - `ANTHROPIC_API_KEY` is **optional** — only populate if flipping `ENGINE_PROVIDER=anthropic` during a codex availability incident.

5. **Deploy**
   ```bash
   vercel --prod
   ```
   Or push to `main` — Vercel auto-deploys on push if the integration is enabled.

5.5 **Deploy Korean Law MCP server**
   - 로컬/단일 운영 노드면 `LAW_API_KEY=<key> npm run daemon:law-mcp` 또는 `scripts/law-mcp-server.plist` 로 상주시킨다.
   - 별도 호스팅이면 `scripts/law-mcp-server.ts` 를 Fly.io / Cloud Run 같은 Node 런타임에 올리고 `KOREAN_LAW_MCP_URL=https://<host>` 로 앱 env 를 맞춘다.
   - smoke:
   ```bash
   curl -sS http://127.0.0.1:4100/health
   curl -sS 'http://127.0.0.1:4100/laws/lookup?title=산업안전보건법'
   ```

6. **Smoke test after deploy**
   ```bash
   curl -sS https://<your-domain>/                          # expect 307 → /login
   curl -sS https://<your-domain>/login                     # expect 200
   curl -sS -X POST https://<your-domain>/api/ask -d '{}'   # expect 401 auth_expired
   curl -sS -H "Authorization: Bearer <METRICS_ACCESS_TOKEN>" \
        https://<your-domain>/api/metrics                   # expect 200
   ```

## Subsequent deploys

Standard `git push origin main` triggers CI (typecheck/lint/test/build/e2e) then Vercel deploy. No manual intervention expected.

## Migration changes

1. Add new `.sql` file under `db/migrations/` with next numeric prefix (e.g., `007_your_change.sql`).
2. Add matching entry in `tests/unit/migrations.test.ts`.
3. Run locally against a scratch DB: `DATABASE_URL=<scratch> npm run migrate`.
4. Dry run against production copy before committing: prefer a staging branch with a Postgres replica.
5. After CI green + PR merge, run migration on production **before** first request hits the new code:
   ```bash
   DATABASE_URL="<prod-url>" npm run migrate
   ```
6. Vercel deploy trigger.

Never edit a shipped migration. Always add new ones.

## Rollback

- **Code rollback:** Vercel UI → Deployments → previous deployment → "Promote to Production". No DB changes reversed.
- **Migration rollback:** migrations are forward-only by convention. If a migration caused damage, write `NNN_revert_prior.sql` that undoes only the problem columns/constraints, and run it explicitly. Do not drop the migration-history row.
- **Data rollback:** restore from managed Postgres PITR (point-in-time recovery). Inform affected users — every reopened history snapshot is immutable by contract, so PITR is a last-resort break-glass.

## Secrets rotation

- `AUTH_SECRET`: rotate once per quarter or immediately if leaked. Existing sessions are invalidated on rotation.
- `METRICS_ACCESS_TOKEN`: rotate once per month or whenever an operator leaves.
- `LAW_API_KEY`: rotate per open.law.go.kr policy or on leak suspicion. Update Vercel env → redeploy.
- `ANTHROPIC_API_KEY` (only if ENGINE_PROVIDER=anthropic fallback is active): rotate per Anthropic policy.
- `SMTP_URL`: rotate credentials when the provider requires it. Redeploy.

## Monitoring

- `/api/metrics` (token-gated): Prometheus-compatible metrics. Scrape from external Prometheus or push to Grafana Cloud.
- First-class metrics: `retrieval_top1_hit_rate`, `retrieval_top3_hit_rate`, `retrieval_wrong_law_top3_rate`, `clarify_rate`, `schema_retry_exhaustion_total`, `mcp_disagreement_total`, `per_law_disagreement_rate{law_title}`, `per_stage_budget_burn_ms{stage}`, `verification_concurrency_saturation{status}`, `engine_latency_ms`.
- Error budgets: see `docs/error-budget.md`.

## Incident response

Start with `OPERATIONS.md` for on-call playbook.
