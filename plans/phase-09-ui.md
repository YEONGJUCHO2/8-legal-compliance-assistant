# Phase 9 — UI

## Goal
Build the mobile-first intake and desktop review/export interface so an authenticated user can ask reference-date-aware questions, receive a triage packet as the primary output, request expert review, and safely inspect history or export the packet. This phase owns the product's trust surface: onboarding, loading states, accessibility, and the distinction between verified facts, interpretation, escalation, and failure modes.

## Scope
### In scope
- Mobile-first intake flow with a 360x800 viewport baseline and two facts-first viewport templates
- Desktop review and export surface for the full triage packet
- Question form with explicit reference-date selector and mismatch blocker
- Clarification, answer, history, feedback, export, and recovery surfaces
- Multi-law answer presentation and history snapshot reopen
- Onboarding, service-update surface, and accessibility baseline
- Cancel/edit/resubmit and in-flight draft preservation
- First-class `전문가 검토 요청` affordance and packet-shaped export

### Out of scope (deferred)
- Share links -> deferred to post-MVP
- Interpretive-guidance and case-law UI -> deferred to post-MVP
- Additional enterprise admin views -> deferred to post-MVP

## Dependencies
- Requires: Phase 1 (bootstrap shell), Phase 7 (integrated API), Phase 8 (auth)
- Depends on contracts: `AnswerResponse`, `ClarifyOutput`, `NoMatchOutput`, `SchemaErrorOutput`, `VerificationPendingOutput`, `HistoryListResponse`, `HistorySnapshotResponse`, `FeedbackRequest`, `ExportRequest`
- Depends on invariants: `UF-01 Safe No-Match Phrasing`, `UF-02 Server-Honored Skip Clarification`, `UF-04 Multi-Intent Coverage Disclosure`, `UF-05 Distinct Recovery States`, `UF-06 Queue And Offline Separation`, `UF-07 Localized Verification Delay`, `UF-08 Verification Recovery Ordering`, `UF-09 Staged Loading Skeleton`, `UF-10 First-Run Onboarding`, `UF-11 Draft And Submission Preservation`, `UF-12 Cancel And Resubmit`, `UF-14 Dedicated Current-Law Rerun`, `UF-15 Redaction-Review Export Default`, `UF-16 Deterministic Explicit-Date Parser`, `UF-17 Past-Date Mismatch Blocker`, `UF-18 Multi-Law Expansion Caps`, `UF-19 Collapsed-Law Human Summary`, `UF-20 Accessibility Minimum`, `UF-21 Accessibility Verification Required`, `UF-22 Service-Update Surface`, `UF-24 Facts-First Rendering`, `UF-25 Reading-Order Guidance`, `UF-26 Snapshot Change Disclosure`

## Mobile Viewport Templates (360x800 baseline)
- Template A — `single-law`: `[question] -> [답변 강도 배지] -> [verified facts] -> [결론] -> [first citation: 6-line preview, expandable] -> [주의/예외]`
- Template B — `multi-law`: `[question] -> [답변 범위/미답변 범위 banner] -> [답변 강도 배지] -> [verified facts] -> [결론] -> [collapsed law blocks chip, expand-on-tap]`
- These templates enforce `UF-24 Facts-First Rendering` and `UF-18 Multi-Law Expansion Caps`. `결론` is never the first trust element on screen.
- Tolerance rule: with IME closed, the mobile first screen may span up to two vertical scrolls. Single-scroll fit is preferred but not required.
- If verified facts would otherwise push `결론` completely below the first screen, mobile may swap the full facts list for an optional collapsed verified-facts chip that expands in place; facts remain visible before conclusion in reading order.
- `verification_pending`, `clarify`, and `skip-clarification` variants preserve the same top-of-screen hierarchy by inserting their banner/card state before the answer body rather than collapsing back to a conclusion-led layout.

## Desktop Review Surface
- Desktop is optimized for the compliance-manager review persona: a manager-review header sits above the packet with question, effective date, strength label, changed-law indicator, and `전문가 검토 요청` CTA.
- A sticky right-side packet summary rail stays visible while the main answer body scrolls and always shows `question · effective_date · strength badge · verification status · citation count · export button · 전문가 검토 요청`.
- The same rail also summarizes verified facts, unanswered scope, recommended next owner, escalation path, and post-send status so reviewers can scan the packet without re-reading the full prose body.

## Recovery And State Cards
- `schema_error` card matches `SchemaErrorOutput`: title is `답변 형식 확인 실패`, it shows the message body plus retry-count note (`2회 재시도 후 중단`), preserves the draft, disables auto-retry, routes users to `다시 시도` or `전문가 검토 요청`, and forbids free-text fallback.
- `verification_pending` renders localized `검증 지연` copy ahead of the answer card and locks export/copy until the user explicitly confirms the degraded state where allowed.
- Clarification, skip-confirmed, auth-expired, queue-over-capacity, offline, engine-timeout, and MCP-timeout states each get their own card title, body, and primary action.

## Citation Card Anatomy
- Citation cards implement the shared `Citation` contract, not an ad-hoc UI-only shape.
- Header: `법령명 제X조(제목)` plus `시행일` badge and `changed_since_created` badge when applicable.
- Body: excerpt preview is capped at 6 lines, truncated with gradient fade, and expanded through an explicit CTA.
- Footer: `verification_source: local | mcp`, `in_force_at_query_date` flag, and a copy-citation button.
- Citation preview on mobile shows the first card collapsed to this anatomy; desktop can expand inline for the full packet view.

## IME And Keyboard Rules
- The submit bar stays sticky above the iOS keyboard with `env(safe-area-inset-bottom)` padding applied.
- Primary tap targets remain at least `44x44`.
- The textarea auto-grows until `40vh`, then scrolls internally.
- On mobile, the Enter key never submits; submission happens only through the button. Desktop may add `Cmd+Enter` / `Ctrl+Enter` as an explicit shortcut.
- Keyboard-open state must not cover mismatch confirmation, skip action, or submit.

## Design Tokens And Spacing Appendix
- Typography scale:
  - `heading`: section and packet titles, strongest scan anchor.
  - `body`: default answer and helper copy.
  - `caption`: metadata rows, badge-adjacent supporting text.
  - `micro`: helper warnings, rail footnotes, service-update timestamps.
- Recommended size and line-height pairings:
  - `heading`: `20/28`
  - `body`: `16/24`
  - `caption`: `13/18`
  - `micro`: `12/16`
- Spacing scale: `4 / 8 / 12 / 16 / 24 / 32`
- Color tokens by intent: `strength.clear`, `strength.conditional`, `strength.verification_pending`, `state.error`, `state.info`
- Motion tokens by intent: `motion.micro = 120ms`, `motion.macro = 240ms`

## Approved Korean Microcopy

| Slot | Korean string | Intent |
|---|---|---|
| `no_match` | `확인된 법령 범위 안에서 바로 적용되는 조항을 찾지 못했습니다.` | trust |
| `검증 지연 / verification_pending` | `검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다.` | caution |
| `법령 확인 실패` | `법령 확인 실패: 현재 검증 경로에서 조문 상태를 확인하지 못했습니다.` | state |
| `기준 시점 불일치 확인` | `질문에 과거 시점 표현이 있습니다. 기준 시점을 수정하거나 현재 기준으로 답변받겠다고 확인해 주세요.` | caution |
| `PDF 내보내기 · 민감표현 검토 경고` | `PDF 내보내기 전 민감표현과 회사 식별정보를 직접 확인해 주세요.` | caution |
| `답변 강도: clear` | `답변 강도: 명확` | trust |
| `답변 강도: conditional` | `답변 강도: 조건부 판단` | caution |
| `답변 강도: verification_pending` | `답변 강도: 검증 지연` | state |
| `전문가 검토 요청 (idle)` | `전문가 검토 요청` | state |
| `전문가 검토 요청 (sending)` | `전문가 검토 요청 전송 중` | state |
| `전문가 검토 요청 (sent)` | `전문가 검토 요청 전송됨` | trust |
| `전문가 검토 요청 (failed)` | `전문가 검토 요청 전송 실패` | caution |

## Steps
- [ ] Step 1: Build the app shell and page composition
  - Notes: create `src/components/app-shell.tsx` and wire `app/page.tsx`; the shell owns question draft state, submitted snapshot state, history panel, packet review state, and recovery state.
- [ ] Step 2: Implement the mobile-first question form
  - Notes: include the textarea, explicit reference-date input, deterministic date-hint banner, mismatch-confirmation checkbox, and clear privacy copy about user-scoped history; the mobile baseline is 360x800, not a desktop layout squeezed smaller, and the two approved viewport templates are the acceptance baseline. Single-law uses `question -> strength -> verified facts -> conclusion -> first citation -> caution`, and multi-law uses `question -> scope banner -> strength -> verified facts -> conclusion -> collapsed law chip`.
- [ ] Step 3: Implement staged loading and cancellation
  - Notes: render real stage labels or an indeterminate skeleton; never fake percent progress; expose cancel while preserving the draft and submitted snapshot.
- [ ] Step 4: Implement clarification and recovery cards
  - Notes: add structured states for auth expiry, rate limit, queue overload, offline, engine timeout, MCP timeout, verification delay, `schema_error`, and no-match; keep `skipClarification` available where the server allows it and preserve draft text in every recovery path.
- [ ] Step 4a: Implement `schema_error` and verification-precedence state cards
  - Notes: `schema_error` uses the exact `SchemaErrorOutput` render contract (`답변 형식 확인 실패`, retry count, auto-retry off, expert-review route, no free-text fallback). `verification_pending` and other verification-failure cards must appear before the answer card, and export/copy stays locked until the degraded state is acknowledged.
- [ ] Step 5: Implement the triage packet card
  - Notes: render verified facts first, then conclusion, then explanation and caution; show effective-date badge, strength label, next action, answered vs unanswered scope, citations, missing facts, recommended next owner, escalation path, changed-law warnings, and a first-class `전문가 검토 요청` button. Citation cards must follow the anatomy spec above, including 6-line preview, verification-source footer, and copy-citation affordance.
- [ ] Step 6: Implement multi-law presentation
  - Notes: cap default expansion at four sections on desktop and two on mobile; collapse the remainder behind a human-readable summary that still signals hidden obligations. Mobile multi-law starts with the answered/unanswered scope banner and may use a tap-to-expand verified-facts chip before `결론` when the first screen would otherwise bury the conclusion.
- [ ] Step 7: Implement the desktop manager review header and packet summary rail
  - Notes: desktop must expose the review header and a sticky right-side summary rail so a compliance manager can scan question, effective date, strength, verification status, citation count, export state, ownership, and escalation without re-reading the full packet.
- [ ] Step 8: Implement history and current-law rerun flows
  - Notes: add recent-history list, snapshot reopen panel, changed-since-created indicator, and the dedicated `현재 법령으로 새 답변 생성` action.
- [ ] Step 9: Implement first-run onboarding on empty history
  - Notes: the onboarding panel appears before the empty intake state for users with no history and covers what the app does, what the reference date means, app limits, privacy/storage expectations, and the latest service update headline.
- [ ] Step 9a: Implement persistent `service_updates` surfaces
  - Notes: render a persistent top-strip summary card on both the homepage and history view, backed by the `service_updates` table and keyed to `behavior_version` so users can see material behavior changes without opening a settings page.
- [ ] Step 10: Implement feedback and packet-shaped export surfaces
  - Notes: wire the feedback buttons to `/api/feedback`; wire PDF, clipboard, and print exports around the triage packet and the redaction-review default with explicit user confirmation and the approved export warning copy.
- [ ] Step 11: Implement `전문가 검토 요청` post-click flow
  - Notes: the flow is `redaction review -> recipient picker -> PDF send -> confirmation -> post-send status`. Redaction review highlights candidate sensitive spans (PII, company names, incident details) and lets the user toggle each or confirm all. Recipient picker offers preset destinations (`compliance team`, `legal lead`, `custom email`) and saves the last-used choice. Send generates the redacted PDF with question, answer, citations, effective date, behavior version, timestamp, and disclaimer footer, then emails it with a short note. Confirmation modal copy is `전송됨 · 회수 불가`, links back to the run detail, and post-send state adds an `escalated_at` badge while the button state becomes `sent`. This flow inherits the `UF-15 Redaction-Review Export Default` requirement.
- [ ] Step 12: Verify accessibility and responsive behavior
  - Notes: add keyboard-only coverage, live-region announcements, visible focus, WCAG AA contrast, IME-open layout behavior, and explicit mobile viewport checks for (1) multi-law with answered/unanswered banner and collapsed law chip, (2) `verification_pending` with the state card before the answer card and export/copy locked, and (3) `clarify` plus `skip-clarification` on 360x800.

## Test plan
- Unit: question-form gating; recovery-card branching; `schema_error` render contract; triage-packet rendering order; citation-card anatomy; multi-law collapse summary; export disablement during verification delay.
- Integration: app-shell request lifecycle with mocked API responses for clarify, skip-confirmed answer, answer, no-match, `schema_error`, auth expiry, rate limit, queue overload, offline, engine timeout, MCP timeout, and verification delay.
- E2E (if UI/E2E relevant): first-run onboarding, date-mismatch blocker, ask -> clarify -> skip -> answer, cancel/edit/resubmit, history reopen, current-law rerun, keyboard-only path, `single-law` mobile viewport, `multi-law` mobile viewport with scope banner and collapsed law chip, `verification_pending` mobile viewport with locked export/copy, `clarify/skip` mobile viewport, and redaction-review export plus expert-review-request flow.
- Evals (if LLM-affecting): visual and copy regression checks for trust-critical states; localization checks for `검증 지연` and no-match language.

## Done when
- [ ] The UI distinguishes all recovery states the plan requires without collapsing them into one generic error
- [ ] The mobile intake flow follows the two approved 360x800 facts-first templates, while desktop remains the richer review/export surface
- [ ] Triage packets render evidence first, preserve history safely, and make expert review request and export first-class actions
- [ ] The compliance-manager desktop rail stays visible while the packet scrolls and the expert-review flow records send status back into the run surface
- [ ] Accessibility, loading-state honesty, and export-confirmation behavior are test-covered rather than implicit
- [ ] All invariants from Dependencies section verified
