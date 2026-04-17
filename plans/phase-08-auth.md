# Phase 8 — Auth

## Goal
Add mandatory internal-trial authentication using email magic links while preserving a stable internal user identity that can later attach employee-number login, Google OAuth, or corporate SSO without losing history continuity. This phase makes all history, feedback, export, and engine-session behavior user-scoped instead of anonymous.

## Scope
### In scope
- Email magic-link request and consume flow
- Session storage and current-user helper
- Route protection for ask, history, feedback, and export surfaces
- Internal identity model that supports future provider linking
- No-anonymous-endpoint enforcement

### Out of scope (deferred)
- Employee-number login UI -> deferred to post-MVP
- Corporate OIDC or SAML integration -> deferred to post-MVP
- Org-admin identity-link workflow UI -> deferred to post-MVP
- Pilot-readiness requirement: SSO must ship before the first paid customer pilot

## Dependencies
- Requires: Phase 1 (env, base app), Phase 2 (users, identities, sessions tables)
- Depends on contracts: `UsersRow`, `SessionRow`, `UserIdentityRow`, `FeedbackRequest`, `ExportRequest`
- Depends on invariants: `PG-05 Auth-Scoped History Guard`, `PG-09 Per-User Engine Session Isolation`, `PG-10 Identity Continuity Safety`, `UF-05 Distinct Recovery States`, `UF-10 First-Run Onboarding`

## Steps
- [ ] Step 1: Implement the session and identity helpers
  - Notes: create `src/lib/auth/session.ts` and related helpers; read and validate session tokens against hashed session rows, not raw email state.
- [ ] Step 2: Implement email magic-link issuance
  - Notes: create request and consume endpoints or actions using `SMTP_URL`, `AUTH_SECRET`, and `AUTH_FROM_EMAIL`; store hashed single-use magic-link tokens with TTL, `consumed_at`, browser/CSRF binding metadata, issuance rate limits, and replay protection in addition to the eventual `auth_sessions` row.
- [ ] Step 3: Create or link the internal user row safely
  - Notes: new magic-link logins create `app_users` and `user_identities` rows; later providers must link to the same `app_users.id` through durable identity mapping, not blind email equality. If another provider already claims the same email with a different durable identity, trigger the PG-10 identity-merge conflict flow instead of silently merging.
- [ ] Step 4: Protect server routes
  - Notes: require authentication for ask, history, feedback, export, and current-law rerun surfaces; MVP has no anonymous history or export path.
- [ ] Step 5: Namespace engine and history behavior by user
  - Notes: make the authenticated internal user ID the only key used for session continuation, history lookup, feedback creation, and export ownership.
- [ ] Step 6: Add auth-expiry recovery behavior
  - Notes: route failures should return structured auth-expired payloads so Phase 9 can show the correct recovery state rather than a generic server error.
- [ ] Step 7: Add auth tests
  - Notes: cover magic-link token generation and consumption, current-user lookup, protected-route rejection, and identity-link safety constraints.

## Test plan
- Unit: session-token hashing; current-user lookup; identity-link rules; auth-expiry handling; token TTL/single-use enforcement; browser-binding replay rejection.
- Integration: full magic-link login cycle with session persistence, protected-route access, and conflict-safe identity linking when another provider claims the same email.
- E2E (if UI/E2E relevant): login, session expiry, and return-to-app behavior.
- Evals (if LLM-affecting): none.

## Done when
- [ ] The app has no anonymous ask, history, feedback, or export path
- [ ] Magic-link login works without compromising later identity continuity
- [ ] Auth expiry is recoverable through structured route responses
- [ ] Magic-link tokens are single-use, time-bounded, browser-bound, rate-limited, and replay-safe
- [ ] All invariants from Dependencies section verified
