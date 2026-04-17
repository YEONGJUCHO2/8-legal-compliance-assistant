# Phase 4 — Retrieval

## Goal
Implement the retrieval layer chosen in Phase 02b so a natural-language question plus reference date turns into ranked, date-valid legal evidence for the MVP wedge. Retrieval must normalize real-world jargon, respect effective-date filters, detect weak evidence, and prove itself only on the 산안법/중처법/도급 cluster before the product claims anything broader.

## Scope
### In scope
- A retrieval boundary that can wrap the Phase 02b winner
- Query-time alias normalization
- Strategy-specific ranking, caching, or local-index logic selected by the bake-off
- Effective-date and repeal filtering
- Empty-evidence detection and ranking thresholds
- Retrieval eval harness inputs and score logging hooks for the MVP wedge only

### Out of scope (deferred)
- Clarification policy and ask-route branching -> deferred to Phase 7
- Engine prompting -> deferred to Phase 5
- Runtime citation verification -> deferred to Phase 6

## Dependencies
- Requires: Phase 2 (schema and indexes), Phase 02b (retrieval decision), and any Phase 3 local corpus or cache work required by the winning architecture
- Depends on contracts: `Citation`, `NoMatchOutput`, `ObservabilityLogEvent`
- Depends on invariants: `PG-01 Explicit Reference Date`, `PG-02 Empty Evidence Guard`, `UF-01 Safe No-Match Phrasing`, `UF-03 Alias And Jargon Normalization`, `UF-04 Multi-Intent Coverage Disclosure`

## Internal Retrieval Contract

```ts
type RetrievalResult = {
  items: Array<{
    law_id: string | null;
    article_id: string;
    article_version_id: string | null;
    law_title: string;
    article_number: string;
    excerpt: string;
    effective_from: string;
    effective_to: string | null;
    in_force_on_query_date: boolean;
    retrieval_rank: number;
    match_reason: 'alias' | 'lexical' | 'vector' | 'hybrid' | 'mcp';
  }>;
  outcome: 'ready' | 'weak_evidence' | 'empty';
  normalized_query: string;
  answered_scope_candidates?: string[];
};
```

Phase 7 consumes `RetrievalResult`, not strategy-native scores or provider confidence objects. Raw lexical/vector/MCP confidence details remain inside Phase 4 and observability output so orchestration cannot accidentally branch on backend-specific scoring semantics.

## Steps
- [ ] Step 1: Build the retrieval boundary for the bake-off winner
  - Notes: create the strategy-specific helper under `src/lib/search/`; downstream orchestration should not hard-code whether retrieval is MCP-only, cache-assisted, or local-index-backed, and must consume only the internal `RetrievalResult` interface.
- [ ] Step 2: Normalize the query before scoring
  - Notes: expand the alias dictionary from Phase 3 at query time; keep the original user query for history and prompts, but search over normalized terms.
- [ ] Step 3: Implement the winning ranking path
  - Notes: if the chosen strategy is MCP-only, optimize request shaping and cache reuse; if it is targeted cache or local index, implement the necessary deterministic ranking and score merge there. Retrieval must batch article fetches by unique `(law_id, article_number)` set instead of per-candidate N+1 lookups.
- [ ] Step 4: Enforce effective-date and repeal filters
  - Notes: filter candidates to only those in force at the user-selected reference date unless a later verification phase explicitly reclassifies them.
- [ ] Step 5: Add empty-evidence and weak-evidence detection
  - Notes: define the threshold logic that blocks engine calls when the candidate set is empty or too weak; the message content belongs to Phase 7, but the signal originates here.
- [ ] Step 6: Preserve enough metadata for downstream phases
  - Notes: retrieval results must carry law title, article number, quote excerpt, and effective-date metadata so clarification, generation, and verification do not re-query blindly; hide raw strategy-native confidence fields behind normalized metadata and observability-only logs.
- [ ] Step 7: Add retrieval tests and eval hooks
  - Notes: cover alias cases, appendix matches, effective-date exclusions, top-k ordering, wrong-law suppression, and the chosen architecture's failure modes; build the retrieval gold set only from the MVP wedge corpus.

## Test plan
- Unit: alias expansion; strategy-specific ranking or cache behavior; effective-date filtering; appendix retrieval; empty-evidence detection.
- Integration: run retrieval against the bake-off-selected backend and assert stable top-k output for representative wedge queries without N+1 article fetches.
- E2E (if UI/E2E relevant): none.
- Evals (if LLM-affecting): wedge-only retrieval gold set with Top-1, Top-3, and wrong-law-in-top-3 metrics.

## Done when
- [ ] Retrieval returns ranked, date-valid candidates with enough metadata for later phases
- [ ] Alias-heavy real-world wedge queries no longer collapse into obvious false `no_match` states
- [ ] Weak or empty evidence is detectable before any engine call happens
- [ ] Phase 7 depends only on `RetrievalResult`, not strategy-native confidence or backend-specific score semantics
- [ ] All invariants from Dependencies section verified
