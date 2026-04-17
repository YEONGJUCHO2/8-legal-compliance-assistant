# Phase 3 — Law Ingestion

## Goal
Build the MVP wedge corpus or cache pipeline selected by Phase 02b so the system can serve the 산안법/중처법/도급 cluster with durable article-level content, effective-date history, and appendices where needed. This phase is not a nationwide ingestion commitment; it is the smallest law-content pipeline that supports the chosen retrieval architecture.

## Scope
### In scope
- `open.law.go.kr` DRF client and XML parsing helpers
- Law title normalization and alias dictionary seeding for the MVP wedge
- Wedge-only sync or targeted cache pipeline, depending on the Phase 02b decision
- Corpus sanitization and allowed-text enforcement for stored law text
- Effective-date tracking, repeal flags, and appendix handling for in-scope laws
- Embedding backfill only if the Phase 02b decision selects a local-vector path
- Re-sync hooks for locally flagged stale rows when a local cache exists

### Out of scope (deferred)
- Search ranking and clarification policy -> deferred to Phases 4 and 7
- Runtime answer-time verification -> deferred to Phase 6
- Broader labor law, tax, civil, commercial, and non-wedge sector law coverage -> deferred to post-MVP

## Corpus scope

MVP corpus only:
- `산업안전보건법`
- `산업안전보건법 시행령`
- `산업안전보건법 시행규칙`
- `산업안전보건기준에 관한 규칙`
- `중대재해 처벌 등에 관한 법률`
- `중대재해 처벌 등에 관한 법률 시행령`
- The attached 별표, 별지, appendices, and 도급·관계수급인-related provisions within the laws above

Explicitly out of scope for MVP ingestion:
- Wider labor law such as `근로기준법` and adjacent HR statutes
- Tax, civil, commercial, or general corporate law
- Chemical, environment, fire, construction, and other sector-law expansion beyond the focused safety wedge

Target size:
- Roughly 8 to 15 laws or law-like units maximum for MVP, including implementing decrees, rules, and appendix-heavy related materials chosen by the bake-off decision

## Dependencies
- Requires: Phase 1 (project tooling), Phase 2 (schema, pgvector, migration runner), Phase 02b (architecture decision)
- Depends on contracts: `LawsRow`, `LawArticleRow`, `ArticleVersionRow`, `AppendixRow`, `ObservabilityLogEvent`
- Depends on invariants: `PG-06 Runtime Verification Precedence`, `PG-08 Current-Law Rerun Freshness`, `UF-03 Alias And Jargon Normalization`, `UF-16 Deterministic Explicit-Date Parser`

## Corpus Sanitization Invariant
- Allowed text is inert legal-source content only: statute headings, article labels, body text, appendix labels, tables rendered to plain text, and promulgation/effective-date metadata.
- Strip unsafe markup, embedded scripts, raw HTML attributes, amendment-reason prose that is not part of the operative text, and footnote/appendix decorations that can act like prompt injection or duplicate legal authority.
- Retrieved law text is stored as quoted data for later prompting, never as executable instruction.

## Steps
- [ ] Step 1: Implement the raw law API client and XML helpers
  - Notes: create `src/lib/open-law/client.ts`, `xml.ts`, and `normalize.ts`; parse search and detail responses without binding later phases to raw XML structures.
- [ ] Step 2: Normalize titles and seed alias vocabulary
  - Notes: normalize punctuation variants such as `·` vs `ㆍ`; create a shared dictionary for abbreviations and field jargon that retrieval can reuse later.
- [ ] Step 3: Build the wedge-only sync or targeted-cache command
  - Notes: create `scripts/sync-laws.ts` or equivalent; page only through the in-scope corpus and make the sync strategy match the Phase 02b winner instead of assuming nationwide bulk ingestion.
- [ ] Step 4: Sanitize DRF corpus text before persistence
  - Notes: strip unsafe markup from appendices, footnotes, and amendment reasons; normalize tables and footers to plain text; reject rows that violate the allowed-text invariant instead of silently storing unsafe source material.
- [ ] Step 5: Split laws into article and appendix chunks when the chosen strategy stores local text
  - Notes: preserve `article_path` stability so unchanged content does not fragment history; if the winning strategy is cache-light, only persist the chunks needed for reuse and verification support.
- [ ] Step 6: Track versions and content hashes
  - Notes: compute hashes from sanitized article or appendix content; update `law_articles` in place and append to `law_article_versions` only when content changes. Repealed-then-reinstated text always creates a new `ArticleVersionRow.version`, never an in-place overwrite.
- [ ] Step 7: Track effective dates and repeal state
  - Notes: persist `effective_from`, `effective_to`, and `repealed_at`; enforce repeal-gap and future-effective selection rules so stale or superseded text remains recoverable through the version table whenever local text is stored.
- [ ] Step 8: Add embedding generation only if the bake-off chooses a local-index path
  - Notes: create `scripts/embed-laws.ts`; pin the exact embedding model by commit SHA and tokenizer checksum, store `embedding_model_version` per row, enforce preview/prod parity on that version, and refuse retrieval later if the stored version does not match the active runtime model.
- [ ] Step 9: Add stale-row re-sync hooks
  - Notes: plan `scripts/resync-flagged.ts` or equivalent so Phase 6 can flag local rows for later repair after MCP disagreement.
- [ ] Step 10: Add ingestion and parsing tests
  - Notes: cover XML parsing, appendix extraction, sanitization, title normalization, version rollover, repeal-gap and future-effective fixtures, unchanged upsert behavior, malicious-corpus fixtures, and any strategy-specific cache assumptions.

## Test plan
- Unit: XML search parsing; detail parsing; appendix extraction; sanitization; title normalization; hash stability; article splitting edge cases.
- Integration: import one or more real in-scope laws into a migrated database or cache store; rerun sync to confirm unchanged articles do not create duplicate versions and that invalid corpus fragments are rejected.
- E2E (if UI/E2E relevant): none.
- Evals (if LLM-affecting): corpus-quality smoke checks only for the MVP wedge laws and appendix coverage.

## Done when
- [ ] A sync or cache run can populate the in-scope MVP corpus from `open.law.go.kr`
- [ ] Content changes create new version rows while unchanged content stays stable when local text is stored
- [ ] Repeal-gap, reinstatement, and future-effective amendments behave deterministically through fixtures
- [ ] Embedding backfill exists only if the winning retrieval path needs it, with model-version pinning recorded per row
- [ ] All invariants from Dependencies section verified
