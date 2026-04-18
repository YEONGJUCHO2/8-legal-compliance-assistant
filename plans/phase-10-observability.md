# Phase 10 — Observability

## Goal
Add the structured logging, rate limiting, behavior-version tracking, service-update summaries, and runtime metrics needed to operate the assistant safely. This phase turns the integrated app into something that can explain what changed, defend against abuse, and surface regressions in retrieval, verification, generation, and the lawyer-graded correctness bar.

## Scope
### In scope
- `pino` structured logs and request IDs
- Per-user rate limiting
- Answer-behavior version logging on history rows
- Dated service-update summaries for material behavior changes
- Core product and pipeline metrics
- Error budgets, operational thresholds, and steady-state evaluation tracking

### Out of scope (deferred)
- Full production SRE tooling stack -> deferred to post-MVP
- Automated rollback or autoscaling -> deferred to post-MVP
- Broader business analytics -> deferred to post-MVP

## Dependencies
- Requires: Phase 2 (storage model), Phase 5 (engine boundary), Phase 6 (verification states), Phase 7 (integrated pipeline), Phase 8 (auth identity), Phase 9 (UI service-update surface)
- Depends on contracts: `ObservabilityLogEvent`, `QuestionHistoryRow`, `FeedbackEventRow`, `AnswerResponse`
- Depends on invariants: `PG-05 Auth-Scoped History Guard`, `PG-11 Queue Backpressure`, `PG-13 Deadline Reconciliation`, `UF-05 Distinct Recovery States`, `UF-06 Queue And Offline Separation`, `UF-22 Service-Update Surface`, `UF-23 Answer-Behavior Version Persistence`, `UF-26 Snapshot Change Disclosure`

## Steps
- [ ] Step 1: Add request-scoped structured logging
  - Notes: create `src/lib/logging.ts`; include request ID, user ID, run ID, effective date, retrieval scores, citation metadata, strength, engine latency, schema retries, verification state, per-stage timeout budget burn, verification concurrency saturation, and the runtime budget chosen for the Node ask route.
- [ ] Step 2: Add per-user rate limiting
  - Notes: create `src/lib/rate-limit.ts`; reject abusive or bursty `/api/ask` traffic with a structured 429 payload that the UI can render cleanly.
- [ ] Step 3: Persist answer-behavior versions intentionally
  - Notes: the orchestration phase writes `answer_behavior_version`; this phase defines how the version is advanced, where it is sourced, and how it maps to dated service-update summaries.
- [ ] Step 4: Publish service-update summaries
  - Notes: create or finalize `src/lib/service-updates.ts` and the `service_updates` table usage; log material prompt, model, or retrieval changes as user-readable summaries.
- [ ] Step 5: Add key product metrics
  - Notes: surface Top-1 and Top-3 retrieval hit rate, wrong-law-in-top-3 rate, clarify rate, schema-retry rate, MCP disagreement rate, changed-answer precision, queue saturation, preview/prod embedding-model parity, and p95 engine latency. Required first-class metrics are `per_law_disagreement_rate{law_title}`, `per_stage_budget_burn{stage in [retrieval, generation, verification]}` histogram, `verification_concurrency_saturation` gauge, and `schema_retry_exhaustion_total` counter.
- [ ] Step 6: Expand the eval suite for steady-state tracking
  - Notes: grow the wedge gold set to 200 or more question-to-expected-citation pairs, track it continuously, and keep lawyer-reviewed labels authoritative for product decisions. Required regression suites are: (1) `PG-11` load test where 2x-cap concurrent requests return 503 immediately without queue starvation, (2) `PG-09/10` fuzz matrix covering cross-user session replay, provider migration collision, and identity-link conflict, (3) `UF-16/17` parser eval over Korean date forms including `2024-03-01`, `2024년 3월`, `지난달`, `사고 당시`, and mixed strings with no false auto-conversion on relative phrases, (4) `PG-03` schema-retry exhaustion where two invalid outputs return `schema_error` with zero free-text fallback, (5) verification-parallelism suites where 10-citation answers stay under budget and slow-MCP paths downgrade correctly, and (6) malicious-corpus red-team fixtures where prompt-injection strings inside citations do not alter structured output.
- [ ] Step 7: Define error budgets and alert thresholds
  - Notes: document MVP thresholds for engine timeout rate, verification delay rate, queue overload frequency, and stage-budget exhaustion so the team can decide when the current setup is no longer acceptable; reconcile these thresholds against the pinned Vercel Node runtime timeout and publish the same deadline formula from `PG-13`.
- [ ] Step 8: Add observability tests and smoke checks
  - Notes: verify logs redact secrets, request IDs propagate, rate-limit responses are structured, behavior-version changes surface in service-update output, and eval runs are attributable to a specific versioned configuration.

## Test plan
- Unit: logger field shape; rate-limit token-bucket logic; service-update retrieval; behavior-version mapping; timeout-budget accounting; per-stage budget histogram emission; schema-retry exhaustion counter increments.
- Integration: run a request through the pipeline and assert logs, metrics counters, stored history rows, and eval summaries share request and behavior identifiers consistently across normal, degraded-MCP, and timeout-budget-burn cases.
- E2E (if UI/E2E relevant): verify the UI displays service-update summaries and rate-limit recovery states from real route payloads.
- Evals (if LLM-affecting): compare retrieval and verification metrics before and after any prompt, model, or threshold change; track the 200-plus wedge gold set continuously.

## Done when
- [ ] The system emits structured logs and metrics that explain retrieval, verification, and answer behavior per request
- [ ] Rate limiting and queue-backpressure states are both measurable and user-visible
- [ ] Material behavior changes are traceable through dated summaries and stored behavior-version values
- [ ] A steady-state eval suite of 200 or more wedge gold pairs is wired into ongoing tracking
- [ ] Preview and production refuse mismatched embedding-model versions and expose the mismatch clearly in observability
- [ ] Runtime budgets, alerts, and dashboards all reconcile against the pinned Node `maxDuration` instead of drifting independently
- [ ] All invariants from Dependencies section verified
