# Invariants

This file centralizes the non-negotiable rules from the original plan preamble. Phase plans should reference these invariant names instead of restating them loosely.

`MVP-Blocking Invariants` must be green before the first external user sees the product. The final-gate UF rebalance promoted the old `11 PG + 8 UF MVP / 18 UF Post-MVP` split to `11 PG + 13 UF MVP / 13 UF Post-MVP`, and the engineering gate then added `PG-12` and `PG-13`. The current blocking set is therefore 13 pipeline guards plus 13 UI/trust invariants. `Post-MVP Quality Bar` items remain required roadmap commitments, but they do not block the initial wedge validation if the MVP-blocking set is complete.

## MVP-Blocking Invariants (13 PG + 13 UF)

### Pipeline Hard Guards

### `PG-01 Explicit Reference Date`
- Every answer is bound to an explicit legal reference date.
- Default reference date is server `today`, but the user confirms or overrides it.
- The system may suggest a detected date; it may not silently decide the date on the user's behalf.

### `PG-02 Empty Evidence Guard`
- If retrieval returns an empty evidence set, or if the candidate set would yield zero citations, the engine must not be called.
- The only allowed outcomes are `clarify` or `no_match`.

### `PG-03 Schema Failure Guard`
- Every engine response must satisfy the declared output schema.
- If `--output-schema` validation fails twice on the same request, the pipeline returns `schema_error`.
- Free-text fallback is forbidden.

### `PG-04 Verification Downgrade Guard`
- If MCP verification fails, or a cited article is not in force on the query effective date, the answer strength must be downgraded to `conditional` or `verification_pending`.
- Export/copy affordances must respect that downgraded state.

### `PG-05 Auth-Scoped History Guard`
- History, feedback, export, and rerun operations are scoped to the authenticated internal user row.
- There is no anonymous history endpoint in MVP.

### `PG-06 Runtime Verification Precedence`
- The bulk index comes from `open.law.go.kr`.
- Runtime verification comes from `korean-law-mcp`.
- On disagreement, the live MCP result wins for user-facing rendering, the local index is marked stale, and the stored citation records that rendering came from the verification path.

### `PG-07 Historical Snapshot Integrity`
- For any history reopen, the UI shows the stored snapshot first.
- The product must never silently replace a stored historical answer with today's law text.

### `PG-08 Current-Law Rerun Freshness`
- For any new answer generation, including `현재 법령으로 다시 답변`, the runtime prefers the MCP-verified latest in-force text.
- The rerun flow hard-sets the reference date to server `today` and ignores stale client-side date state.
- Enforcement: if MCP freshness cannot be proven during `rerun_current_law`, the rerun may persist `status='answered'` only with `strength='verification_pending'`; it may never emit `strength='clear'` from unverified freshness.

### `PG-09 Per-User Engine Session Isolation`
- Engine conversation context is carried by a provider-native identifier when available, otherwise by server-managed conversation state.
- Session state is namespaced by authenticated app user ID and never shared across users.

### `PG-10 Identity Continuity Safety`
- `app_users.id` is the durable internal person key across auth-provider changes.
- Future auth migration must link new identities onto the same internal user row.
- Email string equality alone is not a safe merge key.

### `PG-11 Queue Backpressure`
- Queueing, timeout, and queue-depth caps may be used as optional protection when a provider or verification path needs it.
- Requests above the cap return 503 immediately instead of piling up invisibly.

### `PG-12 Corpus Text Inert`
- Retrieved corpus text is treated as quoted data, not as executable or advisory instructions.
- The ingestion sanitizer is the only path allowed to transform upstream law text before it is stored, embedded, prompted, or verified.
- Enforcement: Phase 3 strips unsafe markup and control characters, enforces the allowed-text set, logs and drops unknown runs, and only uses post-sanitize text when computing hashes, embeddings, or prompt citation blocks.

### `PG-13 Deadline Reconciliation`
- Retrieval, generation, and verification budgets must fit inside the pinned Vercel Node runtime `maxDuration` with explicit safety margin.
- The product may downgrade to a structured degraded state before platform timeout; it may not keep running until Vercel aborts the request blindly.
- Enforcement: `RETRIEVAL_DEADLINE_MS + ENGINE_DEADLINE_MS + MCP_VERIFY_DEADLINE_MS + safety_margin <= maxDuration` is documented in Phase 1 and rechecked in Phase 10 dashboards and alerts.

### UI Failure Contracts

### `UF-01 Safe No-Match Phrasing`
- `no_match` is never phrased as "법적 문제 없음" or "의무 없음".
- The UI explicitly says the system failed to confirm a relevant law and suggests the next action.

### `UF-02 Server-Honored Skip Clarification`
- `skipClarification` is honored server-side.
- Clicking skip cannot loop back into the same clarification state.
- Skip means "continue within known limits," not "force a final answer at any cost."
- Rationale: design doc lines 160-169 make skip the user's control valve against clarification churn during field use; without it, the mobile wedge regresses to bureaucratic interrogation.

### `UF-05 Distinct Recovery States`
- Session expiry, rate-limit hit, engine timeout, and MCP timeout each map to distinct structured UI states.
- The user's draft remains in the textbox so they can retry without retyping.

### `UF-09 Staged Loading Skeleton`
- Pending requests render a staged loading skeleton, not just a disabled button.
- Numeric percent progress is forbidden unless the server emitted a real stage or queue signal for that specific request.
- Rationale: design doc lines 235-246 treat waiting-state honesty as trust-critical behavior and explicitly forbid fake progress.

### `UF-10 First-Run Onboarding`
- First-run users see an onboarding surface before the empty form.
- It explains what the app does, how to ask, why the reference date matters, and what the product cannot guarantee.

### `UF-14 Dedicated Current-Law Rerun`
- `현재 법령으로 다시 답변` is a dedicated server-side flow, not a cosmetic client rerender.
- It loads the original question from history and reruns it against server `today`.

### `UF-16 Deterministic Explicit-Date Parser`
- Date hints come only from a deterministic explicit-date parser.
- Explicit absolute forms such as `2024-03-01`, `2024.03`, and `2024년 3월` may produce a suggestion.
- Relative phrases such as `지난달`, `사고 당시`, and `개정 전` may trigger warnings, but must never be auto-converted into a concrete date.

### `UF-17 Past-Date Mismatch Blocker`
- If a past-date hint exists while the selected `effectiveDate` remains `today`, or conflicts with a detected explicit date, submit is blocked.
- The user must either fix the date or explicitly confirm the mismatch.

### `UF-18 Multi-Law Expansion Caps`
- Multi-law answers expand at most 4 law sections on desktop and 2 on mobile by default.
- Remaining law sections collapse behind a `기타 관련 법령 N건` affordance.
- Rationale: design doc lines 194-208 require capped expansion so hidden obligations stay signaled without turning the first result into an infinite scroll.

### `UF-20 Accessibility Minimum`
- Minimum accessibility is mandatory: keyboard navigation, visible focus, live-region announcements for progress and recovery states, and WCAG AA contrast for badges and warnings.

### `UF-23 Answer-Behavior Version Persistence`
- Each stored answer persists the answer-behavior version that produced it.
- Law changes and product-behavior changes must be explainable separately.

### `UF-24 Facts-First Rendering`
- Answer rendering separates verified facts from cited law text from interpretive conclusion.
- The result reads as objective evidence first, reasoning second.
- Rationale: design doc lines 172-192 define verified facts before conclusion as the core anti-ChatGPT trust pattern for this product.

### `UF-25 Reading-Order Guidance`
- First answer views teach users how to read the result: strength label, verified facts, conclusion, and caution are distinct layers.
- Rationale: design doc lines 188-192 and 210-218 require explicit reading-order teaching so users do not flatten strength, facts, and interpretation into one undifferentiated AI answer.

## Post-MVP Quality Bar (13 UF)

### UI Failure Contracts

### `UF-03 Alias And Jargon Normalization`
- Common aliases and field jargon such as `중처법`, `화관법`, `화평법`, `MSDS`, `도급`, and `야간작업` are normalized before retrieval scoring.
- Alias handling exists to prevent false `no_match` outcomes.

### `UF-04 Multi-Intent Coverage Disclosure`
- Multi-intent questions must return both answered scope and unanswered scope.
- Partial coverage is allowed.
- Silent omission is forbidden.

### `UF-06 Queue And Offline Separation`
- Queue-over-capacity 503 and network-offline failures are distinct user-visible states.
- They must not collapse into one generic timeout banner.

### `UF-07 Localized Verification Delay`
- `verification_pending` is rendered as localized `검증 지연`, not as a raw internal token.

### `UF-08 Verification Recovery Ordering`
- If an answer body is shown while verification is pending, the recovery card appears before the answer card.
- Export/copy actions require an extra confirmation before proceeding.

### `UF-11 Draft And Submission Preservation`
- In-flight requests preserve both the submitted snapshot and the editable draft.
- The UI makes it obvious which text is currently being processed.

### `UF-12 Cancel And Resubmit`
- Users can cancel an in-flight request, keep the draft, edit it, and resubmit.

### `UF-13 Idempotent Duplicate Submit`
- Repeated submissions of the same draft are deduplicated server-side with an idempotency key or equivalent request identity.

### `UF-15 Redaction-Review Export Default`
- Export defaults to a redaction-review variant.
- The system highlights sensitive-expression candidates.
- The product never promises perfect anonymization; the user confirms before PDF generation.

### `UF-19 Collapsed-Law Human Summary`
- The collapsed multi-law affordance includes a short human-readable summary of the hidden issues, not just a count.
- Hiding laws must not feel like hiding non-essential detail.

### `UF-21 Accessibility Verification Required`
- Accessibility is not "best effort."
- At least one keyboard-only path and one live-region or focus-management verification step must appear in testing or QA.

### `UF-22 Service-Update Surface`
- Material prompt, model, or retrieval changes surface to users as a dated service-update summary.
- Answer behavior may not drift without explanation.

### `UF-26 Snapshot Change Disclosure`
- If a stored answer's cited law later changes, history surfaces that state as `변경됨` or equivalent.
- Stored snapshots remain readable without mutating the original record.
