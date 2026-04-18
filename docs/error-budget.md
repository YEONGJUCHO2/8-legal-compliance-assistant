# Error Budget

## MVP Thresholds

- Engine timeout rate: `< 2% / week`
- Verification delay rate: `< 5% / week`
- Queue overload frequency: `< 1% / week`
- Stage budget exhaustion: `< 3% / week`

## PG-13 Formula

`RETRIEVAL_DEADLINE_MS + ENGINE_DEADLINE_MS + MCP_VERIFY_DEADLINE_MS + DEADLINE_SAFETY_MARGIN_MS <= ROUTE_MAX_DURATION_SECONDS * 1000`

## Reconciliation

- The ask route is pinned to the Node runtime with `maxDuration = 60`
- `per_stage_budget_burn_ms{stage}` is the runtime-facing metric used to detect drift
- `verification_pending` is preferred over timing out at the platform edge

## Alert Action

- If any threshold exceeds budget, publish a new `service_update`
- Review deadline splits before raising concurrency or prompt length
- Treat repeated queue overload as a Phase 11 scaling trigger
