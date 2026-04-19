# Operations Runbook

On-call playbook. Pair with `DEPLOY.md` for deploy-time tasks and `docs/error-budget.md` for thresholds.

## Health snapshot

Run these against production before declaring "app is up":

```bash
BASE=https://<your-domain>
curl -sS -o /dev/null -w "root=%{http_code}\n" "$BASE/"                 # expect 307
curl -sS -o /dev/null -w "login=%{http_code}\n" "$BASE/login"           # expect 200
curl -sS -o /dev/null -w "unauth=%{http_code}\n" \
  -X POST -H 'content-type: application/json' -d '{}' "$BASE/api/ask"   # expect 401
curl -sS -H "Authorization: Bearer $METRICS_ACCESS_TOKEN" \
  "$BASE/api/metrics" | head -30                                        # expect prom metrics
```

If `/` is not 307, auth route guard is broken — fail fast.

## Symptom → Playbook

### Users see "verification_pending" for everything
- **Most likely**: `korean-law-mcp` is slow or down.
- Check: metrics `mcp_disagreement_total` and `per_stage_budget_burn_ms{stage=verification}` spike.
- Mitigate: verify `KOREAN_LAW_MCP_URL` is reachable from Vercel egress; failover MCP instance if available; widen `MCP_VERIFY_DEADLINE_MS` short-term.
- Follow-up: file incident, investigate MCP provider.

### `/api/ask` returns 429 rate_limited broadly
- Check: `rate_limit_buckets` table in Postgres for abnormal consumption patterns.
- Mitigate: block abusive IPs at Vercel firewall; if it's legitimate traffic, raise the per-user cap temporarily via `src/lib/rate-limit.ts` (requires deploy).
- Follow-up: inspect logs for abuse signatures.

### Magic-link emails not delivered
- Check: `/api/auth/request` logs for `email_delivery_failed`.
- Mitigate: confirm SMTP provider status page; if transient, tell users to retry. If provider is down, switch `SMTP_URL` to backup provider credentials.
- Follow-up: if authentication failure, rotate SMTP credentials.

### Database connection errors
- Check: managed Postgres provider status.
- Mitigate: if quota hit, scale up DB plan; if failover needed, flip read replica to primary.
- Follow-up: DB connection pooling in `src/lib/db/client.ts` — consider tuning `max` connections.

### Schema errors spike (`schema_retry_exhaustion_total`)
- Check: Anthropic model version and recent prompt changes. `answer_behavior_version` column on `assistant_runs`.
- Mitigate: revert the most recent `behavior_version` via code rollback; this effectively reverts prompt/model changes.
- Follow-up: add a regression eval for the prompt shape that broke.

### Budget exhaustion on many requests
- Check: `per_stage_budget_burn_ms` histogram percentiles.
- Mitigate: widen the offending stage's deadline in env, redeploy. But watch `ROUTE_MAX_DURATION_SECONDS` — the sum must still fit in Vercel's function timeout.
- Follow-up: tune parallelism or cache hit rates upstream.

## Data integrity

- History snapshots are **immutable** (invariant `UF-26`). Never UPDATE `assistant_runs` or `assistant_run_citations` rows outside of migration.
- Current-law reruns create **new** rows in `assistant_runs` — never overwrite.
- If a data corruption incident occurs, restore from PITR (see DEPLOY.md rollback).

## Log hygiene

- Logs must never contain: magic-link bearer tokens, session cookies, `AUTH_SECRET`, `ANTHROPIC_API_KEY`, `LAW_API_KEY`, `SMTP_URL`.
- Structured logs emit `request_id`, `user_id`, `run_id`, `effective_date`, but **redact** citation bodies for PII safety.
- If you see a secret in logs, rotate the exposed secret immediately; files on Vercel log drain are retained ~30 days.

## Contact

- On-call rota: TODO — assign when service goes live
- Escalation: file GitHub issue + ping #legal-compliance Slack channel
