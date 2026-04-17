# Phase 7 — Clarification Orchestration

## Goal
Wire the end-to-end assistant pipeline so a request moves through reference-date validation, retrieval, evidence guarding, clarification, generation, verification, persistence, and response shaping. This phase is where the subsystem plans become one server-side flow that honors skip behavior, multi-intent handling, idempotency, cancellation, current-law reruns, and the correctness gate for the expert-ready triage packet.

## Scope
### In scope
- `/api/ask` request validation and response shaping
- Deterministic date-confirmation gate
- Multi-intent split and partial-coverage response assembly
- Retrieval -> clarify/no-match/answer branching
- Engine call and verification integration
- History persistence, idempotency, and cancellation
- Dedicated `현재 법령으로 다시 답변` server flow

### Out of scope (deferred)
- Final interactive UI and recovery cards -> deferred to Phase 9
- Production dashboards and rate-limit metrics -> deferred to Phase 10
- Extra data sources beyond the MVP wedge laws and appendices -> deferred to post-MVP

## Dependencies
- Requires: Phase 4 (retrieval), Phase 5 (engine adapter), Phase 6 (verification), Phase 8 (auth for non-anonymous routes)
- Depends on contracts: `AskRequest`, `AskResponse`, `AnswerResponse`, `ClarifyOutput`, `NoMatchOutput`, `HistoryListResponse`, `HistorySnapshotResponse`, `QuestionHistoryRow`, `QuestionHistoryCitationRow`
- Depends on invariants: `PG-01 Explicit Reference Date`, `PG-02 Empty Evidence Guard`, `PG-03 Schema Failure Guard`, `PG-04 Verification Downgrade Guard`, `PG-05 Auth-Scoped History Guard`, `PG-07 Historical Snapshot Integrity`, `PG-08 Current-Law Rerun Freshness`, `UF-01 Safe No-Match Phrasing`, `UF-02 Server-Honored Skip Clarification`, `UF-04 Multi-Intent Coverage Disclosure`, `UF-05 Distinct Recovery States`, `UF-06 Queue And Offline Separation`, `UF-12 Cancel And Resubmit`, `UF-13 Idempotent Duplicate Submit`, `UF-14 Dedicated Current-Law Rerun`, `UF-16 Deterministic Explicit-Date Parser`, `UF-17 Past-Date Mismatch Blocker`, `UF-23 Answer-Behavior Version Persistence`

## Steps
- [ ] Step 1: Implement the request envelope and route validation
  - Notes: create `app/api/ask/route.ts`; accept the `ask` and `rerun_current_law` modes defined in `CONTRACTS.md` and reject invalid payloads with structured JSON. Reuse of an existing `client_request_id` with a drifted payload is a hard conflict, not a dedupe hit.
- [ ] Step 2: Add deterministic date-confirmation gating
  - Notes: if the query contains an explicit or suspicious past-date hint that conflicts with the selected date, return `date_confirmation_required` before retrieval begins.
- [ ] Step 3: Normalize and split the query for orchestration
  - Notes: preserve the raw question for history, normalize terms for retrieval, and split multi-intent prompts into sub-questions that can later produce answered and unanswered scope.
- [ ] Step 4: Run retrieval and branch before generation
  - Notes: call the selected retriever, apply `PG-02`, and choose one of three outcomes: `no_match`, `clarify`, or proceed to answer generation.
- [ ] Step 5: Honor `skipClarification` on the server
  - Notes: if clarification would otherwise trigger, skipping must force the pipeline into a bounded conditional-answer attempt or a `no_match`/error state; it may not re-emit the same clarification card.
- [ ] Step 6: Generate, verify, and assemble the triage packet inputs
  - Notes: pass selected citations to the engine adapter, run Phase 6 verification over the deduplicated `(law_id, article_number)` set, and assemble the answer, evidence, missing facts, recommended next owner, and escalation-path fields needed by the UI and export layer.
- [ ] Step 7: Persist runs, citations, and rerun ancestry
  - Notes: create `src/lib/assistant/run-query.ts` and `src/lib/history.ts`; record status, effective date, behavior version, rerun parent, schema retry count, citation verification metadata, and the explicit terminal `schema_error` envelope after schema-retry exhaustion.
- [ ] Step 8: Add idempotency and cancellation
  - Notes: enforce `(user_id, client_request_id)` uniqueness, return the active request identity on duplicate submit, reject payload drift on reused IDs, and mark accepted-but-aborted work as `canceled`.
- [ ] Step 9: Implement the dedicated current-law rerun flow
  - Notes: load the original question from history, hard-set the reference date to server `today`, and create a new run rather than mutating the stored snapshot. The rerun path must fail-closed to `verification_pending` when MCP freshness cannot be proven; it must not emit a fresh current-law conclusion from stale training data.

## Test plan
- Unit: date-confirmation gate; clarify-vs-answer thresholding; skip behavior; rerun request shaping; idempotency key handling; payload-drift conflict rejection.
- Integration: full request path from `/api/ask` through retrieval, generation, verification, and persistence using mocked dependencies, including fail-closed rerun behavior when freshness proof is unavailable.
- E2E (if UI/E2E relevant): API-driven ask, clarify, skip, answer, cancel, and rerun-current-law flows.
- Evals (if LLM-affecting): multi-intent routing suite; no-match phrasing suite; schema-error and verification-delay regression suite.

## Done when
- [ ] A single server route can process ask, clarify, answer, cancel, and current-law rerun behavior without violating invariants
- [ ] Duplicate submits do not create duplicate runs, and canceled accepted requests remain auditable
- [ ] Multi-intent questions preserve answered and unanswered scope instead of collapsing to one summary
- [ ] Current-law reruns fail-closed to `verification_pending` whenever MCP freshness cannot be proven
- [ ] A gold set of at least 50 wedge questions with expected citations is graded by a practicing Korean compliance lawyer, and the Top-1 citation hit rate meets the blocker threshold that the team sets before Phase 7 closes
- [ ] All invariants from Dependencies section verified
