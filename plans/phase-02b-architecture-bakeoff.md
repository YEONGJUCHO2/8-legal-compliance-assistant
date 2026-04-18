# Phase 02b — Architecture Bake-off

## Goal
Spend one week prototyping three retrieval strategies on roughly 30 representative questions from the MVP wedge so the team can choose an architecture with evidence instead of instinct. The bake-off compares (a) MCP-only with aggressive caching, (b) targeted cache plus live MCP verification, and (c) full pgvector local index.

## Scope
### In scope
- A one-week retrieval spike across the three candidate strategies
- Roughly 30 representative 산안법/중처법/도급-cluster questions
- Measurement of p50 and p95 latency, coverage, cost per query, freshness-lag tolerance, behavior under MCP downtime, cold-start cost on serverless, and mandatory correctness/operability gates
- A written architecture decision and required edits to Phases 03 and 04

### Out of scope (deferred)
- Production-grade tuning, retries, and autoscaling
- Full observability rollout
- Broader corpus expansion beyond the MVP wedge

## Dependencies
- Requires: Phase 1 (tooling baseline), Phase 2 (schema and persistence primitives)
- Depends on contracts: `Citation`, `NoMatchOutput`, `ObservabilityLogEvent`
- Depends on invariants: `PG-01 Explicit Reference Date`, `PG-02 Empty Evidence Guard`, `PG-04 Verification Downgrade Guard`, `PG-06 Runtime Verification Precedence`

## Steps
- [ ] Step 1: Define the representative bake-off question set
  - Notes: use about 30 real-world wedge questions spanning 산안법, 중처법, 도급, 관계수급인, and appendix-heavy scenarios; include a small number of ambiguous or low-evidence prompts. Before the spike starts, declare the wedge gold set and the mandatory accuracy gate every strategy must clear: Top-1 retrieval >= 70%, Top-3 retrieval >= 90%, and wrong-law-in-top-3 < 5%. Any option that misses one of these thresholds is rejected regardless of cost or latency.
- [ ] Step 2: Prototype MCP-only with aggressive caching
  - Notes: measure the simplest viable path first, including warm-cache and cold-cache behavior; document degraded behavior explicitly because MCP-only has no local fallback when `korean-law-mcp` is slow or down. Disqualify the strategy if it cannot emit an `mcp_disagreement` signal for user-facing verification precedence.
- [ ] Step 3: Prototype targeted cache plus live MCP verification
  - Notes: scope the cache only to likely-hit wedge laws and keep answer-time verification live; verify the strategy can preserve disagreement signaling, can age safely under stale cache conditions, and degrades gracefully when MCP fails 50% of the time.
- [ ] Step 4: Prototype the full pgvector local-index path
  - Notes: include the minimal local ingestion, embedding, and retrieval work needed to compare latency and reliability, not to harden the whole stack; measure `@xenova/transformers` worst-case first-invocation latency on serverless including model-weight load, plus HNSW RAM/disk footprint and embedding throughput. Record that this path can still answer without MCP verification, but only with the downgraded behavior defined elsewhere.
- [ ] Step 5: Run the comparison under nominal and degraded MCP conditions
  - Notes: capture latency, coverage, cost, freshness lag tolerance, and the reliability tradeoff when MCP is slow or unavailable; degraded mode must explicitly include a 50% MCP failure-rate scenario and verify graceful downgrade instead of silent false confidence. Each option write-up must state its degraded-MCP behavior in one sentence: MCP-only has no local fallback, targeted-cache can age, full-local-index can answer without verification.
- [ ] Step 6: Commit the decision document
  - Notes: write `docs/architecture-bakeoff.md` with a go/no-go decision for every option, the chosen path, and the concrete Phase 03 and 04 edits that follow from the choice. The decision must record the accuracy gate, cold-start budget, degraded-MCP behavior, `mcp_disagreement` capability, and HNSW/embedding measurements; any strategy that fails a mandatory gate is disqualified even if it is cheaper or faster. Phases 03 and 04 must not start until this file exists.

## Test plan
- Unit: none required beyond lightweight harness helpers for measurement capture.
- Integration: run the same representative question set through all three strategies and log comparable output, including Top-1 retrieval, Top-3 retrieval, wrong-law-in-top-3, cold-start latency, and degraded-MCP behavior.
- E2E (if UI/E2E relevant): none.
- Evals (if LLM-affecting): the bake-off set is a spike-only evaluation set and does not replace the later lawyer-graded gold set.

## Done when
- [ ] `docs/architecture-bakeoff.md` is committed with a clear winner and rejection rationale
- [ ] The winner clears the predeclared retrieval gate on the wedge gold set: Top-1 >= 70%, Top-3 >= 90%, wrong-law-in-top-3 < 5%
- [ ] The winner is justified by p50 and p95 latency, coverage, cost per query, freshness lag tolerance, MCP-downtime behavior, and serverless cold-start budget
- [ ] The selected strategy can emit `mcp_disagreement`; MCP-only is disqualified if it cannot
- [ ] If the local-index path remains viable, HNSW RAM/disk footprint and embedding throughput measurements are recorded
- [ ] Phase 03 and Phase 04 scope language is updated to reflect the winning architecture
- [ ] Phases 03 and 04 remain blocked until the bake-off decision file exists with go/no-go outcomes for all three options
