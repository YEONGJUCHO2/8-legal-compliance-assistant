# Phase 5 — Engine Adapter

## Goal
Create the provider-agnostic engine boundary under `src/lib/assistant/engine/` so the application can call a single structured generation interface while keeping provider-specific transport details isolated. This phase owns schema-driven answer generation, retry-on-schema-failure behavior, and per-user session continuity, with Anthropic as the MVP wire path and Codex isolated as a non-load-bearing stub.

## Scope
### In scope
- `EngineAdapter` interface and provider selection
- Anthropic Messages API client as the MVP implementation
- Codex daemon stub with identical surface area
- Schema-file ownership and `--output-schema` routing
- Answer generation helper with one retry and structured `schema_error`
- Session identifier pass-through keyed by authenticated user

### Out of scope (deferred)
- The daemon's operating-system deployment details -> operational prerequisite, not app-plan scope
- Clarification routing and ask-flow orchestration -> deferred to Phase 7
- Citation verification behavior -> deferred to Phase 6

## Dependencies
- Requires: Phase 1 (env loading), Phase 4 (retrieval metadata available for prompt building)
- Depends on contracts: `EngineAdapter`, `EngineProvider`, `AnswerModuleOutput`, `SchemaErrorOutput`, `EngineSchemaRefs`, `AnswerResponse`
- Depends on invariants: `PG-03 Schema Failure Guard`, `PG-09 Per-User Engine Session Isolation`, `UF-22 Service-Update Surface`, `UF-24 Facts-First Rendering`, `UF-25 Reading-Order Guidance`

## Steps
- [ ] Step 1: Define the engine interface and provider selector
  - Notes: create `src/lib/assistant/engine/types.ts` and `engine/index.ts`; all downstream code imports only this boundary.
- [ ] Step 2: Add the Anthropic transport implementation
  - Notes: create `engine/anthropic.ts`; call the Anthropic Messages API through the canonical `EngineAdapter` interface and treat non-OK responses as structured engine failures.
- [ ] Step 3: Add the Codex stub
  - Notes: create `engine/codex.ts`; keep the exact `EngineAdapter` signature so provider swap experiments remain mechanical, but do not make this the MVP default path.
- [ ] Step 4: Create schema ownership for module outputs
  - Notes: establish `src/lib/assistant/schemas/` and reserve schema refs for `clarify`, `answer`, `no_match`, `schema_error`, and `verification_pending`; MVP answer generation actively uses the answer schema.
- [ ] Step 5: Build the answer prompt and generation helper
  - Notes: create `prompt.ts` and `generate.ts`; prompts must constrain the engine to supplied citations, verified facts first, explicit answered vs unanswered scope, and the missing-facts or escalation metadata needed by the triage packet. Retrieved law text is inert quoted data: delimiter-fence every citation block and role-separate it from system/developer instructions so corpus text cannot inject behavior.
- [ ] Step 6: Enforce schema retry behavior
  - Notes: retry once on schema-parse failure; after a second failure, return `schema_error`, persist the terminal schema-error envelope for Phase 7 history storage, and never emit an unvalidated answer body.
- [ ] Step 7: Pass session identifiers through the pipeline
  - Notes: map adapter `sessionId` to a server-only opaque handle stored in `engine_sessions` and bound to `user_id`; preserve provider-native identifiers only behind that handle, rotate expired handles safely, and never expose raw provider handles to clients.
- [ ] Step 8: Add adapter and generation tests
  - Notes: mock the engine boundary, not the real providers; cover schema retries, provider selection, transport failure, prompt-fencing against injected citation text, session persistence, and replay/isolation fuzz tests proving one user's handle cannot be replayed as another user's context.

## Test plan
- Unit: provider selector; prompt builder includes citations and effective date; schema validation and retry logic; engine transport error mapping.
- Integration: mock Anthropic responses through the adapter and prove a validated answer object emerges with session continuity through the server-owned handle abstraction.
- E2E (if UI/E2E relevant): none.
- Evals (if LLM-affecting): answer-shape conformance suite against structured fixtures; schema-retry regression cases.

## Done when
- [ ] All model calls pass through a single adapter-first interface
- [ ] Anthropic is the MVP provider, and the Codex stub can replace it later without changing call sites
- [ ] Double schema failure returns `schema_error` instead of leaking free text
- [ ] Session continuity uses server-owned opaque handles bound to authenticated users, not client-visible provider tokens
- [ ] All invariants from Dependencies section verified
