# Runtime Budget

Phase 01 pins server work to the Vercel Node runtime and keeps an explicit
`maxDuration` budget so later ask and verification routes can fail closed before
the platform timeout.

## Reconciliation rule

`RETRIEVAL_DEADLINE_MS + ENGINE_DEADLINE_MS + MCP_VERIFY_DEADLINE_MS + DEADLINE_SAFETY_MARGIN_MS <= ROUTE_MAX_DURATION_SECONDS * 1000`

## Baseline

- `runtime`: `nodejs`
- `maxDuration`: `ROUTE_MAX_DURATION_SECONDS`
- Recommended starting budget: 60 seconds
- Safety headroom is reserved so Phase 06 and Phase 07 can downgrade to
  `verification_pending` instead of timing out at the platform edge
- Observe each stage against `per_stage_budget_burn_ms{stage}` so retrieval,
  generation, and verification drift is reconciled to the same PG-13 formula
