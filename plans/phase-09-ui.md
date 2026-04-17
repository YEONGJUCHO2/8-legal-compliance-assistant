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
- `single-law`: `[question] -> [verified-facts card] -> [결론] -> [citation preview]`
- `multi-law`: `[question] -> [답변범위/미답변범위 banner] -> [verified-facts chip, tap-to-expand] -> [결론] -> [citation preview]`
- The mobile hierarchy is facts-first in both templates. `결론` is never the first trust element on screen.
- `verification_pending`, `clarify`, and `skip-clarification` variants preserve the same top-of-screen hierarchy by swapping in their banner/card state ahead of the answer body rather than collapsing back to a conclusion-led layout.

## Desktop Review Surface
- Desktop adds a manager-review header with question, effective date, strength label, changed-law indicator, and `전문가 검토 요청` CTA aligned in the top rail.
- A packet summary rail stays visible beside the main packet and contains verified facts, unanswered scope, recommended next owner, escalation path, and export state so reviewers can scan the packet without re-reading the full prose body.

## Recovery And State Cards
- `schema_error` card matches `SchemaErrorOutput`: concise failure title, message body, retry-count note (`2회 재시도 후 중단`), preserved draft, and actions for `다시 시도` and `전문가 검토 요청`.
- `verification_pending` renders localized `검증 지연` copy ahead of the answer card and locks export/copy until the user explicitly confirms the degraded state where allowed.
- Clarification, skip-confirmed, auth-expired, queue-over-capacity, offline, engine-timeout, and MCP-timeout states each get their own card title, body, and primary action.

## Citation Card Anatomy
- Each citation card shows law title plus article number, one source sentence, a 90 to 180 character excerpt block, verification source, and the applicable effective date.
- The `시행일` badge appears in the metadata row directly under the law title.
- If the cited law changed since the stored snapshot, a `변경됨` badge appears before the excerpt and links to changed-law disclosure copy.
- Citation preview on mobile shows the first card collapsed to this anatomy; desktop can expand inline for the full packet view.

## IME And Keyboard Rules
- The submit bar stays sticky above the mobile keyboard with safe-area padding applied from the bottom inset.
- Primary tap targets remain at least 44x44.
- The textarea grows until a defined max height before internal scrolling begins.
- Keyboard-open state must not cover mismatch confirmation, skip action, or submit.

## Design Tokens And Spacing Appendix
- Color tokens: `--color-bg`, `--color-surface`, `--color-surface-alt`, `--color-text`, `--color-muted`, `--color-accent`, `--color-warning`, `--color-danger`, `--color-success`, `--color-border`
- Type tokens: `--font-ui`, `--font-reading`, `--text-xs`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl`
- Spacing scale: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px`
- Radius and shadow tokens live in the same appendix so cards, banners, rails, and citation previews do not drift visually.

## Approved Korean Microcopy

| Surface | Approved copy |
|---|---|
| `no_match` | `확인된 법령 범위 안에서 바로 적용되는 조항을 찾지 못했습니다.` |
| `verification_pending` | `검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다.` |
| mismatch confirmation | `질문에 과거 시점 표현이 있습니다. 기준일을 이 날짜로 확정하시겠습니까?` |
| export warning | `내보내기 전 민감정보와 회사 식별정보를 다시 확인해 주세요.` |

## Steps
- [ ] Step 1: Build the app shell and page composition
  - Notes: create `src/components/app-shell.tsx` and wire `app/page.tsx`; the shell owns question draft state, submitted snapshot state, history panel, packet review state, and recovery state.
- [ ] Step 2: Implement the mobile-first question form
  - Notes: include the textarea, explicit reference-date input, deterministic date-hint banner, mismatch-confirmation checkbox, and clear privacy copy about user-scoped history; the mobile baseline is 360x800, not a desktop layout squeezed smaller, and the two approved viewport templates are the acceptance baseline.
- [ ] Step 3: Implement staged loading and cancellation
  - Notes: render real stage labels or an indeterminate skeleton; never fake percent progress; expose cancel while preserving the draft and submitted snapshot.
- [ ] Step 4: Implement clarification and recovery cards
  - Notes: add structured states for auth expiry, rate limit, queue overload, offline, engine timeout, MCP timeout, verification delay, `schema_error`, and no-match; keep `skipClarification` available where the server allows it and preserve draft text in every recovery path.
- [ ] Step 5: Implement the triage packet card
  - Notes: render verified facts first, then conclusion, then explanation and caution; show effective-date badge, strength label, next action, answered vs unanswered scope, citations, missing facts, recommended next owner, escalation path, changed-law warnings, and a first-class `전문가 검토 요청` button. Citation cards must follow the anatomy spec above.
- [ ] Step 6: Implement multi-law presentation
  - Notes: cap default expansion at four sections on desktop and two on mobile; collapse the remainder behind a human-readable summary that still signals hidden obligations. Mobile multi-law starts with the answered/unanswered scope banner and a tap-to-expand verified-facts chip before `결론`.
- [ ] Step 7: Implement the desktop manager review header and packet summary rail
  - Notes: desktop must expose the review header and always-visible summary rail so a manager can scan facts, scope gaps, ownership, and export state without re-reading the full packet.
- [ ] Step 8: Implement history and current-law rerun flows
  - Notes: add recent-history list, snapshot reopen panel, changed-since-created indicator, and the dedicated `현재 법령으로 새 답변 생성` action.
- [ ] Step 9: Implement onboarding and service-update surfaces
  - Notes: turn the Phase 1 placeholder into a real onboarding flow and dated service-update module; first-run onboarding teaches reference-date meaning, reading order, and product limits before the empty intake state appears.
- [ ] Step 10: Implement feedback and packet-shaped export surfaces
  - Notes: wire the feedback buttons to `/api/feedback`; wire PDF, clipboard, and print exports around the triage packet and the redaction-review default with explicit user confirmation and the approved export warning copy.
- [ ] Step 11: Implement `전문가 검토 요청` post-click flow
  - Notes: the flow is `redaction review -> recipient picker -> PDF send -> confirmation -> post-send status`; each step preserves packet context, highlights redaction candidates before send, and records send status in the packet rail after completion.
- [ ] Step 12: Verify accessibility and responsive behavior
  - Notes: add keyboard-only coverage, live-region announcements, visible focus, WCAG AA contrast, IME-open layout behavior, and viewport checks for `single-law`, `multi-law`, `verification_pending`, and `clarify/skip` mobile states.

## Test plan
- Unit: question-form gating; recovery-card branching; triage-packet rendering order; citation-card anatomy; multi-law collapse summary; export disablement during verification delay.
- Integration: app-shell request lifecycle with mocked API responses for clarify, skip-confirmed answer, answer, no-match, `schema_error`, auth expiry, rate limit, queue overload, offline, engine timeout, MCP timeout, and verification delay.
- E2E (if UI/E2E relevant): first-run onboarding, date-mismatch blocker, ask -> clarify -> skip -> answer, cancel/edit/resubmit, history reopen, current-law rerun, keyboard-only path, `single-law` mobile viewport, `multi-law` mobile viewport, `verification_pending` mobile viewport, `clarify/skip` mobile viewport, and redaction-review export plus expert-review-request flow.
- Evals (if LLM-affecting): visual and copy regression checks for trust-critical states; localization checks for `검증 지연` and no-match language.

## Done when
- [ ] The UI distinguishes all recovery states the plan requires without collapsing them into one generic error
- [ ] The mobile intake flow follows the two approved 360x800 facts-first templates, while desktop remains the richer review/export surface
- [ ] Triage packets render evidence first, preserve history safely, and make expert review request and export first-class actions
- [ ] Accessibility, loading-state honesty, and export-confirmation behavior are test-covered rather than implicit
- [ ] All invariants from Dependencies section verified
