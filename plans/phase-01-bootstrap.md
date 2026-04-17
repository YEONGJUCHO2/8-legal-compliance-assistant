# Phase 1 — Bootstrap

## Goal
Create the minimal Next.js application skeleton, TypeScript setup, env loading, and test harness so later phases can add server routes and UI without reworking the foundation. This phase also establishes the landing page shell that teaches first-run users what the product does and why the reference date matters.

## Scope
### In scope
- Next.js App Router skeleton with TypeScript and strict path aliases
- Vitest and Playwright baseline wiring
- Zod-based env loading and `.env.example`
- Vercel Node runtime pin and function-timeout baseline for ask/verification routes
- Root layout, global styles, and landing page shell
- One landing-page smoke test and one browser boot test

### Out of scope (deferred)
- Real ask-flow UI and history sidebar -> deferred to Phase 9
- Auth gates and session handling -> deferred to Phase 8
- Assistant routes, retrieval, and engine integration -> deferred to Phases 4, 5, and 7

## Dependencies
- Requires: none
- Depends on contracts: `AskRequestSchema` naming conventions, `EngineProvider`, and environment-variable conventions from `CONTRACTS.md`
- Depends on invariants: `UF-09 Staged Loading Skeleton`, `UF-10 First-Run Onboarding`, `UF-20 Accessibility Minimum`, `UF-22 Service-Update Surface`

## Steps
- [ ] Step 1: Create the app skeleton and dependency manifest
  - Notes: add `package.json`, `tsconfig.json`, `next.config.ts`, and the minimal script set for dev, build, unit test, e2e test, and migration helpers; do not inline finalized dependency versions in this phase plan.
- [ ] Step 2: Add environment parsing and local-development examples
  - Notes: create `.env.example` and `src/lib/env.ts`; include database, law API, MCP, engine provider, daemon URL, app base URL, auth-related variables, and the ask-route max-duration budget used later for MCP timeout reconciliation.
- [ ] Step 3: Pin the runtime baseline before any server routes ship
  - Notes: declare the ask and verification handlers as Vercel Node runtime, not Edge; record the allowed function duration and reserve headroom so downstream phases can downgrade to `verification_pending` before the platform timeout.
- [ ] Step 4: Build the root layout and landing page shell
  - Notes: create `app/layout.tsx`, `app/page.tsx`, and `app/globals.css`; include product purpose, reference-date explanation, limitations, and a placeholder entry point for service-update summaries.
- [ ] Step 5: Add the unit-test harness
  - Notes: create `tests/setup.ts`, `vitest.config.ts`, and `tests/unit/home-page.test.tsx`; assert the heading, helper copy, and onboarding guidance that later phases will preserve.
- [ ] Step 6: Add the browser-test harness
  - Notes: create `playwright.config.ts` and one app-boot smoke test that proves the app can render in a browser and that the landing page remains reachable.
- [ ] Step 7: Lock the basic accessibility baseline
  - Notes: ensure the initial shell already has semantic headings, form-label placeholders where needed, and visible focus styles in CSS so later phases do not start from an inaccessible base.

## Test plan
- Unit: env parsing rejects missing required variables; landing page renders onboarding text and reference-date explanation; service-update placeholder is visible.
- Integration: app boot resolves path aliases and global styles without hydration errors; runtime config exposes the Node/max-duration baseline used by later ask routes.
- E2E (if UI/E2E relevant): home page loads; viewport smoke for desktop and mobile; first screen contains onboarding copy.
- Evals (if LLM-affecting): none.

## Done when
- [ ] The app builds and the test harness runs without any assistant-specific logic present
- [ ] The landing page explains the product purpose, reference-date meaning, and usage boundaries
- [ ] Env loading is centralized and fails fast on invalid configuration
- [ ] The project pins a Node runtime and timeout budget early enough for Phase 6 and Phase 7 to reconcile MCP deadlines against platform limits
- [ ] All invariants from Dependencies section verified
