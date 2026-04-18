# Phase 6 — MCP Verification

## Goal
Add the `korean-law-mcp` verification layer that checks every cited article at answer time before the user sees the result. This phase protects the product from stale local data by favoring live verification, recording disagreement, and downgrading answer strength when current-law certainty is missing.

## Scope
### In scope
- Typed `korean-law-mcp` client
- Citation verification at answer time
- Unknown or missing article handling
- Disagreement resolution in favor of MCP
- Local stale-row marking and `rendered_from_verification` metadata
- In-force checks for the query effective date

### Out of scope (deferred)
- Bulk re-sync scheduling and monitoring polish -> deferred to Phase 10
- UI rendering of verification delays -> deferred to Phase 9
- Ask-route integration -> deferred to Phase 7

## Dependencies
- Requires: Phase 3 (local law corpus exists), Phase 5 (structured answer generation boundary exists)
- Depends on contracts: `Citation`, `AnswerResponse`, `VerificationPendingOutput`, `QuestionHistoryCitationRow`, `EngineSchemaRefs`
- Depends on invariants: `PG-04 Verification Downgrade Guard`, `PG-06 Runtime Verification Precedence`, `PG-08 Current-Law Rerun Freshness`, `UF-07 Localized Verification Delay`, `UF-08 Verification Recovery Ordering`, `UF-26 Snapshot Change Disclosure`

## Steps
- [ ] Step 1: Create the typed MCP client
  - Notes: add `src/lib/open-law/mcp-client.ts`; wrap law lookup, article lookup, and effective-date query operations behind a narrow API the rest of the app can trust.
- [ ] Step 2: Define the verification input and output contract
  - Notes: verification accepts local citations plus the query effective date and returns normalized citations, disagreement flags, verification source, and any downgrade signal. Local metadata fetches must be batched by unique `(law_id, article_number)` set to avoid retrieval-side N+1 reads.
- [ ] Step 3: Parallel verification against live MCP data
  - Notes: compare article identity, text, and effective-date range; handle missing or unknown articles explicitly rather than silently accepting the local row. Fan out verification in parallel with a concurrency cap of 4 to 6, enforce a configurable `MCP_VERIFY_DEADLINE_MS` budget (default `3000ms`) aligned to the Node runtime timeout, stop scheduling further verifications once the budget is exhausted, persist partial results with per-citation `verification_source`, and downgrade to `verification_pending` before the platform timeout rather than timing out the whole request.
- [ ] Step 4: Apply disagreement precedence
  - Notes: if local and MCP content disagree, render the MCP-backed text to the user, record `rendered_from_verification`, and mark the local article or version as stale for later re-sync.
- [ ] Step 5: Enforce in-force checks
  - Notes: if an article is not in force on the query date, downgrade to `conditional`; if verification cannot finish or current applicability remains uncertain, downgrade to `verification_pending`.
- [ ] Step 6: Persist verification metadata
  - Notes: store verification timestamps, source, disagreement flags, latest-version pointers, and change summaries on citation rows so history can explain later drift.
- [ ] Step 7: Add failure and timeout handling
  - Notes: return a structured verification-delay signal for Phase 9; do not collapse MCP timeout into generic engine timeout behavior, and include deadline-expired vs platform-timeout-preempted reasons for observability.
- [ ] Step 8: Add verification tests
  - Notes: cover happy path, missing article, disagreement, stale marking, in-force downgrade, a 10-citation answer that stays within budget, the same answer with injected slow MCP calls, full MCP downtime, and timeout-to-`verification_pending` behavior.

## Test plan
- Unit: MCP client request mapping; text disagreement detection; effective-date validation; downgrade logic; stale-marking payload generation; deadline-budget downgrade behavior.
- Integration: compare seeded local citations against mocked MCP responses and confirm the returned citations are normalized and properly flagged under both normal and capped-parallel verification, including partial-result persistence when the verification budget is exhausted.
- E2E (if UI/E2E relevant): none.
- Evals (if LLM-affecting): citation-verification regression suite using changed-law fixtures and missing-article fixtures.

## Done when
- [ ] Every user-visible citation can be verified against `korean-law-mcp` before rendering
- [ ] MCP disagreement wins for rendering and leaves a durable stale-data trail for later repair
- [ ] Verification delay and in-force mismatch downgrade answer strength without collapsing into silent failure
- [ ] Verification runs in capped parallelism, avoids N+1 metadata fetches, persists partial results safely, and downgrades before the platform timeout budget is exhausted
- [ ] All invariants from Dependencies section verified
