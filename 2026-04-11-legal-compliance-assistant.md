# Legal Compliance Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-first web app for internal beta users that ingests Korean laws from `open.law.go.kr` **and** the `korean-law-mcp` server, lets the user explicitly set the legal reference date, retrieves relevant statutes from natural-language questions, asks clarifying questions only when necessary, and returns source-backed answers with citations, effective-date badges, structured error states, and a hard "no citations = no answer" guard.

**Architecture:** Use a Next.js App Router app with authenticated server routes and a small assistant pipeline on the server. PostgreSQL stores users, law documents, law articles, article versions, question history, auth sessions, feedback events, and observability logs. Retrieval uses hybrid lexical plus vector search against the local index, then a deterministic clarification gate decides whether to ask a follow-up question or call the **AI engine adapter** to draft a source-bounded answer for a specific **query effective date**. Before answer rendering, cited articles are cross-checked against the **law MCP client** in real time; any mismatch downgrades the strength label, stores verification metadata on the citation, and flags the local row for re-sync.

**Product decisions fixed in this plan:**
- **Reference date:** explicit user input, default = today. The system may suggest a detected date, but the user confirms it.
- **Auth:** mandatory from MVP internal beta onward (email magic link is sufficient).
- **Sharing:** no share links in MVP. Export is limited to PDF, clipboard copy, and print layout.
- **Content scope:** appendices/annexes are MVP-required; Ministry of Employment and Labor interpretive guidance is phase 2.
- **Future enterprise auth:** the MVP uses magic links, but the user model must be extensible to employee-number login and corporate SSO without losing history continuity.

**Data sources (dual path):**
- **Primary / bulk indexing:** `open.law.go.kr` official open API, currently consumed through the DRF endpoints served at `law.go.kr`, into PostgreSQL (laws, articles, appendices, effective dates, repeal flags, content hashes).
- **Secondary / runtime verification & on-demand lookup:** `korean-law-mcp` server, invoked by the assistant pipeline to (a) verify the current text and effective-date range of every cited article at answer time, and (b) fetch laws or articles that are missing from the local index.
- On disagreement, the live MCP result wins for user-facing rendering, the local index is marked stale, and the citation row stores that the answer was rendered from the verification path.
- For any **new answer generation** (including "현재 법령으로 다시 답변"), the runtime must prefer the MCP-verified latest in-force text. For any **history reopen**, the UI must show the stored snapshot first and never silently replace it with today's law text.

**AI engine (adapter pattern — required from day one):** All model calls go through `src/lib/assistant/engine/` which exposes a single interface (`generate({ sessionId?, prompt, schema }) → { sessionId, response }`). The MVP implementation is a **Codex CLI in MCP server mode** (`codex mcp-server`) wrapper running 24/7 on a Mac mini behind a Node.js daemon at `CODEX_DAEMON_URL`, accepting per-module `--output-schema`. A second implementation stub (`engine/anthropic.ts`) is created but left unimplemented; the adapter interface and tests exist so swapping providers during a Codex/ToS/availability incident is a one-afternoon change rather than a refactor. Per-user conversation context is carried via provider-native session IDs (Codex `resume` in the MVP) and always keyed by authenticated app user ID.

**Hard guards enforced by the pipeline (non-negotiable):**
- If the retrieved evidence set is empty or produces zero citations, the engine must not be called; the response is `clarify` or `no_match`.
- If `--output-schema` validation fails twice in a row on the same request, the request returns `schema_error` to the UI — never a free-text hallucination.
- If MCP verification fails or any cited article's effective date is not in force at the query effective date, the answer strength is auto-downgraded to `conditional` or `verification_pending`.
- History, feedback, and export operations are scoped to the authenticated user ID. There is no anonymous history endpoint in MVP.

**User-facing failure contracts (must also be implemented, not just documented):**
- `no_match` is never phrased as "법적 문제 없음" or "의무 없음". The UI must explicitly say that the system failed to confirm a relevant law and suggest the next action.
- `skipClarification` must be honored server-side. Clicking the non-final skip action cannot loop back into the same clarification state.
- Common aliases and field jargon (`중처법`, `화관법`, `화평법`, `MSDS`, `도급`, `야간작업`) must be normalized before retrieval scoring; otherwise real users will see false `no_match` states too often.
- Multi-intent questions must return both answered scope and unanswered scope. Partial coverage is allowed; silent omission is not.
- Session expiry, rate-limit hit, engine timeout, and MCP timeout all return structured UI states. The user's question draft remains in the textbox so they can retry without retyping.
- Queue-over-capacity 503 and network-offline failures are distinct user states. They must not collapse into the same generic timeout banner.
- `verification_pending` is rendered to users as a localized **검증 지연** recovery state, not as a raw internal token.
- If an answer body is shown while `verification_pending`, the UI must render the recovery card before the answer card and require an extra confirmation before export/copy actions.
- Pending requests render a staged loading skeleton, not just a disabled button. Numeric percent progress is forbidden unless the server emitted a real stage or queue signal for that specific request.
- First-run users must see a clear onboarding surface before the empty form: what the app does, how to ask, why the reference date matters, and what the product cannot guarantee.
- In-flight requests must preserve both the submitted snapshot and the editable draft. The UI must make it obvious which text is currently being processed.
- The user can cancel an in-flight request, keep the draft, and resubmit after editing.
- Repeated submissions of the same draft must be deduplicated server-side with an idempotency key or equivalent request identity.
- `현재 법령으로 다시 답변` is a dedicated server-side flow: it loads the original question from history, hard-sets the reference date to server `today`, and ignores any stale client-side date value.
- Export defaults to a **redaction-review** variant. The system highlights sensitive-expression candidates, but never promises perfect anonymization; the user confirms before PDF generation.
- Date hints must come from a **deterministic explicit-date parser**. Relative phrases such as `지난달`, `사고 당시`, `개정 전` can trigger a warning banner, but they must never be auto-converted into a concrete date.
- If a past-date hint is present while the selected `effectiveDate` remains `today` (or conflicts with an explicit detected date), the UI must block submit until the user either fixes the date or explicitly confirms the mismatch.
- Multi-law answers must cap their default UI footprint: expand at most **4 law sections on desktop** and **2 on mobile**, then collapse the rest behind a `기타 관련 법령 N건` affordance.
- The collapsed multi-law affordance must include a short human-readable summary of the hidden issues, not just a count. Hiding laws must not look like hiding non-essential details.
- Minimum accessibility is part of the contract: keyboard navigation, visible focus, live-region announcements for progress/recovery states, and WCAG AA contrast for badges/warnings.
- Accessibility is not “best effort.” At least one keyboard-only test path and one live-region/focus-management verification step must appear in the test or QA plan.
- Material prompt/model/retrieval changes must surface to users as a dated service-update summary; otherwise answer behavior can drift without explanation.
- Answer history should persist the answer-behavior version that produced the result so law changes and product-behavior changes can be explained separately.
- Future auth migration must attach new login identities to the existing internal user row. Email string equality alone is not a safe merge key.
- Answer rendering must separate **verified facts from cited law text** from **interpretive conclusion** so the result reads as objective evidence first, reasoning second.

**Tech Stack:** Next.js 15, React 19, TypeScript, PostgreSQL 16, pgvector, `postgres` client, magic-link authentication, **Codex CLI (`codex mcp-server`) + Node.js daemon (stdio ↔ HTTP wrapper)** behind an engine adapter, **`korean-law-mcp` client** for law data, `fast-xml-parser`, `@xenova/transformers` (embedding model: `intfloat/multilingual-e5-base`, 768-dim, cosine, pgvector `hnsw` index), Vitest, Playwright, `pino` for structured logs.

---

## Infrastructure Prerequisites

Before Task 6 can integrate with the assistant engine, the following must exist.

### 1. AI engine (Codex daemon)
1. **Mac mini host** running `codex` CLI (already installed), signed in (`codex login`), with a consistent working directory for session files.
2. **`codex mcp-server`** launched under `launchd` (see `scripts/codex-daemon.plist`) so the MCP server is always up.
3. **Node.js daemon** (`scripts/codex-daemon.ts`) that:
   - Owns the stdio pipe to the MCP server (single controlling process).
   - Exposes HTTP `POST /generate` accepting `{ sessionId?, prompt, schema }`.
   - Wires `--output-schema` (writing the schema to a temp file per request), runs the MCP request, parses the JSON response, and returns `{ sessionId, response }` to the caller. On schema validation failure, retries once; on second failure returns a structured error — never relaxes the schema.
   - Manages per-user `sessionId` via Codex `resume` so each user's conversation context is isolated. Sessions are namespaced by authenticated app user ID (never shared across users) to prevent cross-user context leakage.
   - Serializes concurrent requests on the single MCP instance (FIFO queue) with a per-request timeout and a queue-depth cap. Above the cap, requests return 503 immediately rather than piling up.
4. **Tunnel** (Tailscale Funnel / ngrok / equivalent) exposing the daemon to the Next.js deployment. Local dev can point `CODEX_DAEMON_URL` at `http://127.0.0.1:4100`.

### 2. Engine adapter (Codex replacement path)
The web app never imports the Codex daemon directly. Task 6 builds `src/lib/assistant/engine/` with:
- `engine/types.ts` — the single `generate()` interface.
- `engine/codex.ts` — MVP implementation (calls `CODEX_DAEMON_URL`).
- `engine/anthropic.ts` — stub implementation with the same interface, throwing "not implemented" but shaped so a real Anthropic SDK call can be dropped in during an incident.
- `engine/index.ts` — selects implementation from `ENGINE_PROVIDER` env var (`codex` in MVP).

This adapter is required on day one, not later. It is the escape hatch for the SPOF and ToS risks listed below.

### 3. Law data MCP (runtime verification)
1. **`korean-law-mcp` server** reachable from the Next.js runtime, either self-hosted (preferred for availability) or via the upstream deployment.
2. **`src/lib/open-law/mcp-client.ts`** — typed client that invokes the MCP server's tools (law lookup by ID, article text fetch, effective-date query). Used in two places:
   - Task 3 sync pipeline: fallback when the direct `open.law.go.kr` API returns a law the parser cannot handle.
   - Task 7 answer pipeline: real-time verification of each cited article's current text and effective date before the answer is returned to the UI.
3. `LAW_MCP_URL` env var configures the endpoint. Local dev can run the MCP server locally.

### 4. Observability, auth, and abuse control (must be wired before first human user)
- **Auth**: minimal email-magic-link login gate. Every request carries an app user ID; Codex `sessionId`s are namespaced per user; history queries are filtered by the same user ID.
- **Identity continuity:** when magic-link users later move to employee-number login / SSO, the system links the new provider identity onto the same `app_users.id`. Prefer `(organization_id, employee_number)` or an admin-approved mapping over blind email-based auto-merge.
- **Logging**: `pino` structured logs for every request with `{ userId, queryId, queryEffectiveDate, retrievalScores, citations, strength, engineLatencyMs, schemaRetries, verificationState }`. Feedback-button clicks append to the same log stream.
- **Rate limiting**: per-user token bucket on `/api/ask` to prevent a single actor from exhausting the Codex quota and taking the service down for others.
- **Metrics surfaced to a dashboard** (can be Grafana or a single `/admin/metrics` route in MVP): Top-1 / Top-3 citation hit rate against the golden set, wrong-law-in-top-3 rate, clarify rate, schema-retry rate, MCP disagreement rate, changed-answer flag precision, p95 engine latency, feedback ratios.

### 5. Known risks (accepted for internal 10-user beta; revisit before public launch)
- OpenAI Codex ToS gray zone when relaying a personal account across multiple users. **Mitigation:** engine adapter allows swap to Anthropic/OpenAI official API in hours.
- Single-host SPOF (home power/network on Mac mini). **Mitigation:** same adapter enables moving the engine to a cloud host without app-side refactor.
- Single MCP instance serializes requests; no horizontal scaling. **Mitigation:** queue-depth cap + 503 backpressure so one slow request does not silently block all others.

Unit tests for web-app-side code (Task 6) mock both the engine adapter and the law-MCP client — no real daemon or MCP server needed. Daemon implementation and law-MCP self-hosting are separate work streams (not TDD-driven in the same way as web code) and are out of scope for the 8 tasks below.

---

## Planned File Structure

- `package.json` — app scripts and dependency manifest
- `tsconfig.json` — TypeScript config with `@/*` path alias
- `next.config.ts` — minimal Next.js config
- `.env.example` — required local env vars
- `app/layout.tsx` — root HTML shell
- `app/page.tsx` — desktop-first landing page and app shell mount point, with onboarding/trust guidance for first-time users and a service-update summary entry point
- `app/globals.css` — base styles
- `app/api/ask/route.ts` — POST endpoint for question → clarify/answer flow, with request-stage progress emission hooks and request-idempotency support
- `app/api/history/route.ts` — GET endpoint for recent question history
- `app/api/history/[runId]/route.ts` — GET endpoint for one stored answer snapshot
- `src/lib/env.ts` — Zod-based env parsing
- `src/lib/db.ts` — shared PostgreSQL client
- `src/lib/auth/session.ts` — current-user helper; MVP uses magic links but the contract must be reusable for employee-number login / SSO later
- `src/lib/open-law/client.ts` — raw Open API fetch layer (direct `open.law.go.kr`)
- `src/lib/open-law/xml.ts` — XML parsing helpers
- `src/lib/open-law/normalize.ts` — law title normalization helpers
- `src/lib/open-law/mcp-client.ts` — typed client for the `korean-law-mcp` server (runtime verification + on-demand fetch)
- `src/lib/open-law/effective-date.ts` — effective-date resolution and "in force at time T" helper
- `src/lib/law/split-articles.ts` — split full law text into article chunks
- `src/lib/law/split-appendices.ts` — split appendix/annex content into searchable chunks
- `src/lib/search/lexical.ts` — full-text retrieval, alias-aware query normalization, and deterministic reranking
- `src/lib/search/hybrid.ts` — vector merge and hybrid scoring
- `src/lib/assistant/types.ts` — shared response contracts, including multi-law sections and partial-coverage metadata
- `src/lib/assistant/clarify.ts` — pre-answer clarification policy and conservative date-hint rules
- `src/lib/assistant/prompt.ts` — prompt builder that forbids unsupported claims
- `src/lib/assistant/schemas/` — JSON Schema files for each of the 5 assistant modules (search/evidence/strength/clarify/answer), passed to the engine via `--output-schema`
- `src/lib/assistant/engine/types.ts` — single `generate({ sessionId?, prompt, schema }) → { sessionId, response }` interface (provider-agnostic)
- `src/lib/assistant/engine/codex.ts` — Codex daemon adapter (MVP default; HTTP POST to `CODEX_DAEMON_URL`)
- `src/lib/assistant/engine/anthropic.ts` — stub adapter with identical shape; implemented when Codex path becomes unavailable
- `src/lib/assistant/engine/index.ts` — selects adapter via `ENGINE_PROVIDER` env var
- `src/lib/assistant/generate.ts` — calls the engine adapter and validates response against Zod mirror of the answer schema (one retry on schema failure, then structured error)
- `src/lib/assistant/guardrails.ts` — hard guards: no citations → no engine call; expired effective date → auto-downgrade strength
- `src/lib/assistant/verify-citations.ts` — cross-checks each cited article against `korean-law-mcp` at answer time
- `src/lib/assistant/run-query.ts` — end-to-end orchestration and persistence
- `src/lib/rate-limit.ts` — per-user token bucket for `/api/ask`
- `src/lib/logging.ts` — `pino` structured logger with request-scoped fields
- `src/lib/export/pdf.ts` — answer PDF export with sensitive-expression candidate extraction, mandatory review state on the default path, effective-date badges, and disclaimer footer
- `src/lib/service-updates.ts` — server-side helper that returns the current answer-behavior version and dated service-update summaries for the landing page/history UI
- `scripts/codex-daemon.ts` — Node.js daemon (runs on Mac mini): spawns `codex mcp-server`, manages the stdio pipe, exposes HTTP endpoint, handles per-user session `resume` IDs
- `scripts/codex-daemon.plist` — launchd plist template for Mac mini 24/7 operation
- `src/lib/history.ts` — recent run queries plus stored-snapshot lookup for UI/history API
- `src/components/app-shell.tsx` — main client state container, including onboarding empty state, submitted-vs-draft separation, staged loading skeleton, and cancel/retry controls
- `src/components/question-form.tsx` — input form, example prompts, date guidance, privacy note, and pending helper text
- `src/components/answer-card.tsx` — final answer UI (verified-facts block, strength label + next-action, effective-date badges, disclaimer footer, redaction-review export path, changed-answer banner, capped multi-law sections with collapse, answered/unanswered scope notice)
- `src/components/clarification-card.tsx` — clarification prompt UI with **"가정 포함 임시 답변 보기"** skip button
- `src/components/history-list.tsx` — recent run sidebar with "변경됨" flag, original snapshot reopen, and "현재 법령으로 다시 답변" action
- `src/components/history-snapshot-panel.tsx` — reopen one stored answer snapshot without mutating it
- `src/components/recovery-card.tsx` — localized recovery states for auth expiry, rate limit, timeout, no-match, verification delay, with screen-reader announcements
- `src/components/feedback-buttons.tsx` — "도움이 되었나요 / 근거가 엉뚱함 / 결론이 틀림" trio, wired to logging pipeline
- `db/migrations/001_init.sql` — initial schema, indexes, pgvector setup
- `scripts/migrate.ts` — apply SQL migrations in order
- `scripts/sync-laws.ts` — import laws from `open.law.go.kr`, with `korean-law-mcp` as a fallback for unsupported payloads; records effective dates and repeal status
- `scripts/resync-flagged.ts` — re-fetches laws flagged by the answer-time MCP verification step (runs on a schedule), flips `assistant_runs.changed_since_created`, and stores per-citation `changed_summary` metadata when a cited article version is no longer current
- `scripts/embed-laws.ts` — generate and store article embeddings (multilingual-e5-base, 768-dim, chunk granularity = article level; appendices chunked separately)
- `scripts/seed-dev.ts` — local seed data for UI and manual testing
- `scripts/build-golden-set.ts` — harness for building/extending the 200+ golden-set Q↔article mapping from interview inputs
- `scripts/eval-retrieval.ts` — runs the golden set and prints Top-1 / Top-3 hit rates and wrong-law-in-top-3 rate; used to justify any change to retrieval thresholds
- `tests/setup.ts` — Vitest DOM setup
- `tests/unit/home-page.test.tsx` — landing page smoke test
- `tests/unit/migration-contract.test.ts` — migration contract checks
- `tests/unit/open-law-client.test.ts` — XML parsing and normalization tests
- `tests/unit/lexical-search.test.ts` — lexical ranking tests, including alias and appendix cases
- `tests/unit/hybrid-search.test.ts` — hybrid score merge tests
- `tests/unit/clarify.test.ts` — clarification policy tests, including conservative date-hint behavior
- `tests/unit/generate.test.ts` — prompt and output parsing tests (incl. schema-retry and structured error paths)
- `tests/unit/guardrails.test.ts` — no-citations refusal and expired-effective-date downgrade
- `tests/unit/verify-citations.test.ts` — MCP cross-check disagreement handling
- `tests/unit/mcp-client.test.ts` — `korean-law-mcp` client typed wrapper
- `tests/unit/rate-limit.test.ts` — per-user token bucket
- `tests/unit/api-ask-route.test.ts` — `/api/ask` route tests
- `tests/unit/app-shell.test.tsx` — UI state rendering tests (onboarding empty state, date-hint banner, date-confirmation gate, answer card next-action, verified-facts block, effective-date badge, skip-clarification button, loading skeleton/progress stage, cancel action, partial-coverage notice, multi-law collapse summary, structured error states, basic a11y labels)
- `tests/eval/retrieval-goldenset.test.ts` — runs the 200+ golden set and asserts Top-1 / Top-3 hit-rate thresholds and wrong-law-in-top-3 ceiling; any threshold tweak in `clarify.ts` must be justified here before merge
- `tests/e2e/ask-flow.spec.ts` — browser-level ask/clarify/answer flow test, including mobile 1-scroll layout check, onboarding/help text, date-confirmation gate, loading skeleton/progress stage, cancel path, multi-law collapse, keyboard path, and redaction-review PDF export
- `playwright.config.ts` — Playwright config and web server boot
- `vitest.config.ts` — Vitest config

## Task 1: Bootstrap the Next.js app and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `.env.example`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `src/lib/env.ts`
- Create: `tests/setup.ts`
- Create: `tests/unit/home-page.test.tsx`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`

- [ ] **Step 1: Write the failing landing-page test**

```tsx
// tests/unit/home-page.test.tsx
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';

describe('HomePage', () => {
  it('shows the product heading and helper copy', () => {
    render(<HomePage />);

    expect(
      screen.getByRole('heading', { name: '법령 기반 실무 보조' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('대한민국 법령을 기준 시점별로 검색하고 근거 조문과 함께 결론을 제시합니다.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('기준 시점은 답변에 쓰는 법령 버전을 결정합니다.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify the repo is still empty**

Run: `npm run test -- tests/unit/home-page.test.tsx`
Expected: FAIL with `Missing script: "test"` or module resolution errors because the app files do not exist yet.

- [ ] **Step 3: Create the base app files and configs**

```json
// package.json
{
  "name": "legal-compliance-assistant",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:migrate": "tsx scripts/migrate.ts",
    "sync:laws": "tsx scripts/sync-laws.ts",
    "embed:laws": "tsx scripts/embed-laws.ts",
    "seed:dev": "tsx scripts/seed-dev.ts"
  },
  "dependencies": {
    "fast-xml-parser": "^4.5.0",
    "next": "15.3.0",
    "postgres": "^3.4.5",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "zod": "^3.24.3"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^22.15.3",
    "@types/react": "^19.1.2",
    "@types/react-dom": "^19.1.2",
    "jsdom": "^26.1.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

```ts
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
```

```env
# .env.example
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/legal_compliance_assistant
LAW_OC=your-open-law-key
LAW_MCP_URL=http://127.0.0.1:4200
ENGINE_PROVIDER=codex
# Codex daemon URL — optional during bootstrap, required by Task 6
CODEX_DAEMON_URL=http://127.0.0.1:4100
APP_BASE_URL=http://127.0.0.1:3000
AUTH_SECRET=replace-me
SMTP_URL=smtp://username:password@127.0.0.1:1025
AUTH_FROM_EMAIL=legal-assistant@example.com
```

```ts
// src/lib/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LAW_OC: z.string().min(1),
  LAW_MCP_URL: z.string().url(),
  ENGINE_PROVIDER: z.enum(['codex', 'anthropic']).default('codex'),
  CODEX_DAEMON_URL: z.string().url().optional(),
  APP_BASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(1),
  SMTP_URL: z.string().min(1),
  AUTH_FROM_EMAIL: z.string().email(),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  LAW_OC: process.env.LAW_OC,
  LAW_MCP_URL: process.env.LAW_MCP_URL,
  ENGINE_PROVIDER: process.env.ENGINE_PROVIDER,
  CODEX_DAEMON_URL: process.env.CODEX_DAEMON_URL,
  APP_BASE_URL: process.env.APP_BASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  SMTP_URL: process.env.SMTP_URL,
  AUTH_FROM_EMAIL: process.env.AUTH_FROM_EMAIL,
});
```

```tsx
// app/layout.tsx
import './globals.css';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <span className="eyebrow">Legal Compliance Assistant</span>
        <h1>법령 기반 실무 보조</h1>
        <p>대한민국 법령을 기준 시점별로 검색하고 근거 조문과 함께 결론을 제시합니다.</p>
        <ul>
          <li>현장 상황을 문장으로 입력하세요.</li>
          <li>기준 시점은 답변에 쓰는 법령 버전을 결정합니다.</li>
          <li>이 앱은 1차 스크리닝 도구이며 최종 판단은 전문가 확인이 필요합니다.</li>
        </ul>
        <p>예: 비계 설치 자격, 협력업체 교육 책임, 사고 당시 의무</p>
      </section>
    </main>
  );
}
```

```css
/* app/globals.css */
:root {
  color-scheme: light;
  font-family: Inter, Arial, sans-serif;
  background: #f5f7fb;
  color: #0f172a;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.page-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 48px 16px;
}

.hero-card {
  width: min(720px, 100%);
  background: #ffffff;
  border: 1px solid #dbe3f0;
  border-radius: 24px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.08);
}

.eyebrow {
  display: inline-block;
  margin-bottom: 12px;
  color: #3557d6;
  font-size: 14px;
  font-weight: 700;
}

h1 {
  margin: 0 0 12px;
  font-size: 40px;
}

p {
  margin: 0;
  font-size: 18px;
  line-height: 1.6;
}
```

```ts
// tests/setup.ts
import '@testing-library/jest-dom/vitest';
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 4: Install dependencies and rerun the test**

Run: `npm install && npm run test -- tests/unit/home-page.test.tsx`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit the bootstrap**

```bash
git add package.json tsconfig.json next.config.ts .env.example app src tests vitest.config.ts playwright.config.ts package-lock.json
git commit -m "feat: bootstrap legal compliance assistant app"
```

### Task 2: Add PostgreSQL schema and migration runner

**Files:**
- Create: `src/lib/db.ts`
- Create: `db/migrations/001_init.sql`
- Create: `scripts/migrate.ts`
- Create: `tests/unit/migration-contract.test.ts`

- [ ] **Step 1: Write the failing migration contract test**

```ts
// tests/unit/migration-contract.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('001_init.sql', () => {
  it('creates user, law-versioning, and assistant-run tables', () => {
    const sql = readFileSync(
      join(process.cwd(), 'db/migrations/001_init.sql'),
      'utf8',
    );

    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(sql).toContain('CREATE TABLE schema_migrations');
    expect(sql).toContain('CREATE TABLE app_users');
    expect(sql).toContain('CREATE TABLE user_identities');
    expect(sql).toContain('CREATE TABLE law_documents');
    expect(sql).toContain('CREATE TABLE law_articles');
    expect(sql).toContain('CREATE TABLE law_article_versions');
    expect(sql).toContain('CREATE TABLE service_updates');
    expect(sql).toContain('CREATE TABLE assistant_runs');
    expect(sql).toContain('CREATE TABLE assistant_run_citations');
    expect(sql).toContain('answer_behavior_version text NOT NULL');
    expect(sql).toContain('reference_date_confirmed boolean NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE INDEX law_articles_embedding_idx');
  });
});
```

- [ ] **Step 2: Run the migration contract test and verify it fails**

Run: `npm run test -- tests/unit/migration-contract.test.ts`
Expected: FAIL with `ENOENT` because `db/migrations/001_init.sql` does not exist yet.

- [ ] **Step 3: Add the database client, migration SQL, and runner**

```ts
// src/lib/db.ts
import postgres from 'postgres';
import { env } from '@/src/lib/env';

export const db = postgres(env.DATABASE_URL, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
});
```

```sql
-- db/migrations/001_init.sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  employee_number text,
  auth_provider text NOT NULL DEFAULT 'magic_link' CHECK (auth_provider IN ('magic_link', 'oidc', 'saml')),
  external_subject text,
  organization_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_users_org_employee_idx
  ON app_users (organization_id, employee_number)
  WHERE employee_number IS NOT NULL;

-- `app_users.id` is the stable internal person key. Future auth migrations must attach
-- new login methods to this user instead of creating a second history owner row.
-- Never auto-merge identities on raw email equality alone; prefer organization + employee
-- number or an explicit admin-approved linking workflow.
CREATE TABLE user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('magic_link', 'oidc', 'saml')),
  provider_subject text NOT NULL,
  email_snapshot text,
  employee_number_snapshot text,
  organization_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE UNIQUE INDEX user_identities_org_employee_idx
  ON user_identities (organization_id, employee_number_snapshot)
  WHERE employee_number_snapshot IS NOT NULL;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE law_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  law_mst text NOT NULL UNIQUE,
  law_id text,
  title text NOT NULL,
  normalized_title text NOT NULL,
  law_kind text NOT NULL,
  ministry text,
  promulgated_at date,
  source_url text NOT NULL,
  body_markdown text NOT NULL,
  source_hash text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(unaccent(title), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(unaccent(body_markdown), '')), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE law_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES law_documents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('article', 'appendix')),
  law_title text NOT NULL,
  article_number text NOT NULL,
  article_heading text NOT NULL,
  article_text text NOT NULL,
  article_path text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  repealed_at date,
  content_hash text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  embedding vector(768),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(unaccent(law_title), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(unaccent(article_heading), '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(unaccent(article_text), '')), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, article_path)
);

CREATE TABLE law_article_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES law_articles(id) ON DELETE CASCADE,
  version integer NOT NULL,
  article_text text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  repealed_at date,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (article_id, version)
);

CREATE TABLE service_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  behavior_version text NOT NULL UNIQUE,
  summary text NOT NULL,
  affects_answer_behavior boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now()
);

-- `assistant_runs.answer_behavior_version` should correspond to a published
-- `service_updates.behavior_version` value so behavior changes can be explained
-- separately from law-text changes.
CREATE TABLE assistant_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  rerun_from_run_id uuid REFERENCES assistant_runs(id) ON DELETE SET NULL,
  client_request_id text,
  user_query text NOT NULL,
  normalized_query text NOT NULL,
  query_effective_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('clarify', 'answered', 'no_match', 'schema_error', 'engine_error', 'canceled')),
  clarification_question text,
  answer_strength text CHECK (answer_strength IN ('clear', 'conditional', 'verification_pending')),
  conclusion text,
  explanation text,
  caution text,
  changed_since_created boolean NOT NULL DEFAULT false,
  answer_behavior_version text NOT NULL,
  reference_date_confirmed boolean NOT NULL DEFAULT false,
  engine_provider text NOT NULL,
  schema_retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant_run_citations (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES law_articles(id) ON DELETE CASCADE,
  article_version_id uuid NOT NULL REFERENCES law_article_versions(id) ON DELETE RESTRICT,
  quote text NOT NULL,
  position integer NOT NULL,
  verified_at_mcp timestamptz,
  verification_source text NOT NULL CHECK (verification_source IN ('local', 'mcp')),
  mcp_disagreement boolean NOT NULL DEFAULT false,
  latest_article_version_id uuid REFERENCES law_article_versions(id) ON DELETE SET NULL,
  changed_summary text,
  changed_at timestamptz
);

CREATE TABLE feedback_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES assistant_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  feedback_type text NOT NULL CHECK (feedback_type IN ('helpful', 'wrong_citation', 'wrong_conclusion')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX law_documents_search_idx ON law_documents USING gin (search_vector);
CREATE INDEX law_articles_search_idx ON law_articles USING gin (search_vector);
CREATE INDEX law_articles_embedding_idx ON law_articles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX law_articles_effective_idx ON law_articles (effective_from, effective_to, repealed_at);
CREATE INDEX assistant_runs_user_created_at_idx ON assistant_runs (user_id, created_at DESC);
CREATE UNIQUE INDEX assistant_runs_user_request_id_idx
  ON assistant_runs (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX auth_sessions_user_expires_idx ON auth_sessions (user_id, expires_at DESC);
```

```ts
// scripts/migrate.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/src/lib/db';

async function main() {
  const dir = join(process.cwd(), 'db/migrations');
  const files = readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
  await db`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const appliedRows = await db<{ version: string }[]>`
    SELECT version FROM schema_migrations
  `;
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    await db.begin(async (tx) => {
      await tx.unsafe(sql);
      await tx`
        INSERT INTO schema_migrations (version)
        VALUES (${file})
      `;
    });
    console.log(`applied ${file}`);
  }

  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
```

- [ ] **Step 4: Run the contract test, then apply the migration locally**

Run: `npm run test -- tests/unit/migration-contract.test.ts && npm run db:migrate`
Expected: test PASS, then migration output including `applied 001_init.sql`.

- [ ] **Step 5: Commit the database foundation**

```bash
git add src/lib/db.ts db/migrations/001_init.sql scripts/migrate.ts tests/unit/migration-contract.test.ts
git commit -m "feat: add postgres schema and migration runner"
```

### Task 3: Integrate the open.law.go.kr fetch layer and law sync script

**Files:**
- Create: `src/lib/open-law/normalize.ts`
- Create: `src/lib/open-law/xml.ts`
- Create: `src/lib/open-law/client.ts`
- Create: `scripts/sync-laws.ts`
- Create: `tests/unit/open-law-client.test.ts`

- [x] **Step 1: Write the failing XML parsing test**

```ts
// tests/unit/open-law-client.test.ts
import {
  normalizeLawTitle,
  parseLawSearchResponse,
  parseLawDetailResponse,
} from '@/src/lib/open-law/client';

const searchXml = `
<LawSearch>
  <law>
    <법령일련번호>276787</법령일련번호>
    <법령ID>001574</법령ID>
    <법령명한글>근로기준법</법령명한글>
    <법종구분명>법률</법종구분명>
    <소관부처명>고용노동부</소관부처명>
    <공포일자>2024-10-22</공포일자>
    <시행일자>2025-01-01</시행일자>
    <상태>시행</상태>
    <법령상세링크>https://www.law.go.kr/법령/근로기준법</법령상세링크>
  </law>
</LawSearch>`;

const detailXml = `
<법령>
  <기본정보>
    <법령명_한글>근로기준법</법령명_한글>
    <법종구분명>법률</법종구분명>
  </기본정보>
  <조문>
    <조문단위>
      <조문번호>74</조문번호>
      <조문내용>제74조(임산부의 보호) 사용자는 임신 중의 여성을 야간근로에 사용하지 못한다.</조문내용>
    </조문단위>
  </조문>
  <별표>
    <별표단위>
      <별표번호>별표 1</별표번호>
      <별표제목>안전보호구의 종류</별표제목>
      <별표내용>안전모, 안전대</별표내용>
    </별표단위>
  </별표>
</법령>`;

describe('open-law client parsing', () => {
  it('normalizes law titles and parses search, article, and appendix payloads', () => {
    expect(normalizeLawTitle('10·27법')).toBe('10ㆍ27법');

    const searchResult = parseLawSearchResponse(searchXml);
    expect(searchResult[0]).toMatchObject({
      lawMst: '276787',
      lawId: '001574',
      title: '근로기준법',
      lawKind: '법률',
      ministry: '고용노동부',
    });

    const detailResult = parseLawDetailResponse(detailXml);
    expect(detailResult.title).toBe('근로기준법');
    expect(detailResult.bodyMarkdown).toContain('제74조(임산부의 보호)');
    expect(detailResult.appendices[0]).toMatchObject({
      label: '별표 1',
      title: '안전보호구의 종류',
    });
  });
});
```

- [x] **Step 2: Run the parsing test to verify it fails**

Run: `npm run test -- tests/unit/open-law-client.test.ts`
Expected: FAIL because `src/lib/open-law/client.ts` does not exist yet.

- [x] **Step 3: Implement normalization, XML helpers, and the API client**

```ts
// src/lib/open-law/normalize.ts
export function normalizeLawTitle(value: string) {
  return value.replaceAll('·', 'ㆍ').replace(/\s+/g, ' ').trim();
}
```

```ts
// src/lib/open-law/xml.ts
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export function parseXml<T>(input: string): T {
  return parser.parse(input) as T;
}

export function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
```

```ts
// src/lib/open-law/client.ts
import { createHash } from 'node:crypto';
import { env } from '@/src/lib/env';
import { ensureArray, parseXml } from '@/src/lib/open-law/xml';
import { normalizeLawTitle } from '@/src/lib/open-law/normalize';

// `open.law.go.kr` 공식 오픈 API는 현재 DRF 엔드포인트(`law.go.kr/DRF`)를 통해 소비한다.
const SEARCH_ENDPOINT = 'https://www.law.go.kr/DRF/lawSearch.do';
const DETAIL_ENDPOINT = 'https://www.law.go.kr/DRF/lawService.do';

export type RemoteLawSummary = {
  lawMst: string;
  lawId: string | null;
  title: string;
  normalizedTitle: string;
  lawKind: string;
  ministry: string | null;
  promulgatedAt: string | null;
  effectiveAt: string | null;
  status: string;
  sourceUrl: string;
};

export type RemoteLawDetail = {
  title: string;
  bodyMarkdown: string;
  appendices: Array<{ label: string; title: string; bodyMarkdown: string }>;
  sourceHash: string;
};

export function parseLawSearchResponse(xml: string): RemoteLawSummary[] {
  const parsed = parseXml<any>(xml);
  const rows = ensureArray(parsed.LawSearch?.law);

  return rows.map((row) => ({
    lawMst: String(row.법령일련번호),
    lawId: row.법령ID ? String(row.법령ID) : null,
    title: String(row.법령명한글),
    normalizedTitle: normalizeLawTitle(String(row.법령명한글)),
    lawKind: String(row.법종구분명),
    ministry: row.소관부처명 ? String(row.소관부처명) : null,
    promulgatedAt: row.공포일자 ? String(row.공포일자) : null,
    effectiveAt: row.시행일자 ? String(row.시행일자) : null,
    status: String(row.상태 ?? '시행'),
    sourceUrl: String(row.법령상세링크),
  }));
}

export function parseLawDetailResponse(xml: string): RemoteLawDetail {
  const parsed = parseXml<any>(xml);
  const title = String(parsed.법령?.기본정보?.법령명_한글 ?? parsed.법령?.기본정보?.법령명한글);
  const articles = ensureArray(parsed.법령?.조문?.조문단위)
    .map((article) => String(article.조문내용 ?? '').trim())
    .filter(Boolean);
  const appendices = ensureArray(parsed.법령?.별표?.별표단위)
    .map((item) => ({
      label: String(item.별표번호 ?? '별표'),
      title: String(item.별표제목 ?? item.별표번호 ?? '별표'),
      bodyMarkdown: String(item.별표내용 ?? '').trim(),
    }))
    .filter((item) => item.bodyMarkdown.length > 0);
  const bodyMarkdown = articles.join('\n\n');

  return {
    title,
    bodyMarkdown,
    appendices,
    sourceHash: createHash('sha256').update(`${bodyMarkdown}\n${JSON.stringify(appendices)}`).digest('hex'),
  };
}

export async function searchLaws(query: string, page = 1) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('OC', env.LAW_OC);
  url.searchParams.set('target', 'law');
  url.searchParams.set('type', 'XML');
  url.searchParams.set('query', query);
  url.searchParams.set('display', '100');
  url.searchParams.set('page', String(page));

  const response = await fetch(url);
  const xml = await response.text();
  return parseLawSearchResponse(xml);
}

export async function fetchLawDetail(lawMst: string) {
  const url = new URL(DETAIL_ENDPOINT);
  url.searchParams.set('OC', env.LAW_OC);
  url.searchParams.set('target', 'law');
  url.searchParams.set('type', 'XML');
  url.searchParams.set('MST', lawMst);

  const response = await fetch(url);
  const xml = await response.text();
  return parseLawDetailResponse(xml);
}

export { normalizeLawTitle };
```

- [~] **Step 4: Add the sync script and prove it can import one law** _(script committed in `244f8fd`; real-API smoke deferred until LAW_OC key issued)_

```ts
// scripts/sync-laws.ts
import { db } from '@/src/lib/db';
import { fetchLawDetail, searchLaws } from '@/src/lib/open-law/client';

async function main() {
  const query = process.argv.includes('--query')
    ? process.argv[process.argv.indexOf('--query') + 1]
    : '근로기준법';
  const limitArg = process.argv.includes('--limit')
    ? Number(process.argv[process.argv.indexOf('--limit') + 1])
    : 100;
  const results = [];
  let page = 1;

  while (results.length < limitArg) {
    const batch = await searchLaws(query, page);
    if (batch.length === 0) break;
    results.push(...batch);
    page += 1;
  }

  for (const law of results.slice(0, limitArg)) {
    const detail = await fetchLawDetail(law.lawMst);

    await db`
      INSERT INTO law_documents (
        law_mst,
        law_id,
        title,
        normalized_title,
        law_kind,
        ministry,
        promulgated_at,
        source_url,
        body_markdown,
        source_hash,
        updated_at
      )
      VALUES (
        ${law.lawMst},
        ${law.lawId},
        ${law.title},
        ${law.normalizedTitle},
        ${law.lawKind},
        ${law.ministry},
        ${law.promulgatedAt},
        ${law.sourceUrl},
        ${detail.bodyMarkdown},
        ${detail.sourceHash},
        now()
      )
      ON CONFLICT (law_mst)
      DO UPDATE SET
        title = EXCLUDED.title,
        normalized_title = EXCLUDED.normalized_title,
        law_kind = EXCLUDED.law_kind,
        ministry = EXCLUDED.ministry,
        promulgated_at = EXCLUDED.promulgated_at,
        source_url = EXCLUDED.source_url,
        body_markdown = EXCLUDED.body_markdown,
        source_hash = EXCLUDED.source_hash,
        updated_at = now()
    `;

    console.log(`upserted ${law.title}`);
  }

  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
```

Run: `npm run test -- tests/unit/open-law-client.test.ts && npm run sync:laws -- --query 근로기준법 --limit 1`
Expected: test PASS, then output including `upserted 근로기준법`.

- [x] **Step 5: Commit the ingestion foundation** _(`244f8fd`)_

```bash
git add src/lib/open-law scripts/sync-laws.ts tests/unit/open-law-client.test.ts
git commit -m "feat: add open law ingestion client"
```

### Task 4: Split law text into article chunks and add lexical retrieval

**Files:**
- Create: `src/lib/law/split-articles.ts`
- Create: `src/lib/law/split-appendices.ts`
- Create: `src/lib/search/lexical.ts`
- Create: `tests/unit/lexical-search.test.ts`
- Modify: `scripts/sync-laws.ts`

- [x] **Step 1: Write the failing article split and lexical ranking test**

```ts
// tests/unit/lexical-search.test.ts
import { splitLawArticles } from '@/src/lib/law/split-articles';
import { rankLexicalCandidates } from '@/src/lib/search/lexical';

describe('splitLawArticles', () => {
  it('splits article text at line-anchored 제N조 headers', () => {
    const articles = splitLawArticles('근로기준법', [
      '제74조(임산부의 보호) 사용자는 임신 중의 여성을 야간근로에 사용하지 못한다.',
      '제76조(직장 내 괴롭힘 금지) 사용자는 직장 내 괴롭힘을 하여서는 아니 된다.',
    ].join('\n\n'));

    expect(articles).toHaveLength(2);
    expect(articles[0].articleNumber).toBe('제74조');
    expect(articles[0].articleHeading).toBe('임산부의 보호');
    expect(articles[0].articleText).toContain('야간근로');
    expect(articles[1].articleNumber).toBe('제76조');
  });

  it('does NOT split mid-body when the article body references 제X조/제X항/제X호', () => {
    // P0 regression: 과거 regex `[^제]+`는 본문 속 '제' 글자에서 청크가 잘렸음.
    const body = [
      '제56조(연장ㆍ야간 및 휴일 근로) ① 사용자는 연장근로에 대하여는 통상임금의 100분의 50 이상을 가산하여 지급하여야 한다.',
      '② 제1항에도 불구하고 휴일근로에 대하여는 다음 각 호의 기준에 따른 금액 이상을 가산하여 지급한다.',
      '1. 8시간 이내의 휴일근로: 통상임금의 100분의 50',
      '2. 8시간을 초과한 휴일근로: 통상임금의 100분의 100',
      '③ 사용자는 제2항에 따른 가산금액 대신 제55조에 따른 휴일을 줄 수 있다.',
      '',
      '제57조(보상 휴가제) 사용자는 근로자대표와의 서면 합의에 따라 제56조에 따른 연장근로ㆍ야간근로 및 휴일근로 등에 대하여 임금을 갈음하여 휴가를 줄 수 있다.',
    ].join('\n');

    const articles = splitLawArticles('근로기준법', body);

    expect(articles).toHaveLength(2);
    expect(articles[0].articleNumber).toBe('제56조');
    // 본문에 '제1항' '제2항' '제55조' '제56조' 등이 있어도 하나의 청크로 유지되어야 한다.
    expect(articles[0].articleText).toContain('제1항');
    expect(articles[0].articleText).toContain('제55조');
    expect(articles[0].articleText).toContain('휴일근로: 통상임금의 100분의 100');
    expect(articles[1].articleNumber).toBe('제57조');
    expect(articles[1].articleText).toContain('제56조');
  });

  it('handles 조의N (예: 제74조의2) article numbering', () => {
    const body = [
      '제74조(임산부의 보호) 사용자는 임신 중의 여성을 보호한다.',
      '제74조의2(태아검진 시간의 허용 등) 사용자는 임신한 여성근로자가 정기건강진단을 받는 데 필요한 시간을 청구하는 경우 이를 허용하여 주어야 한다.',
    ].join('\n');

    const articles = splitLawArticles('근로기준법', body);

    expect(articles.map((a) => a.articleNumber)).toEqual(['제74조', '제74조의2']);
  });

  it('stops at 부칙 boundary and does not emit empty chunks', () => {
    const body = [
      '제1조(목적) 이 법은 근로조건의 기준을 정함을 목적으로 한다.',
      '',
      '부칙 <법률 제XXXXX호>',
      '이 법은 공포 후 6개월이 경과한 날부터 시행한다.',
    ].join('\n');

    const articles = splitLawArticles('근로기준법', body);

    expect(articles).toHaveLength(1);
    expect(articles[0].articleNumber).toBe('제1조');
    expect(articles[0].articleText).not.toContain('부칙');
  });
});

describe('rankLexicalCandidates', () => {
  it('ranks the most relevant article first using heading boost + token overlap', () => {
    const ranked = rankLexicalCandidates('임산부 야간근로', [
      { id: '74', lawTitle: '근로기준법', articleNumber: '제74조', articleHeading: '임산부의 보호', articleText: '사용자는 임신 중의 여성을 야간근로에 사용하지 못한다.', lexicalScore: 0.6 },
      { id: '76', lawTitle: '근로기준법', articleNumber: '제76조', articleHeading: '직장 내 괴롭힘 금지', articleText: '사용자는 직장 내 괴롭힘을 하여서는 아니 된다.', lexicalScore: 0.6 },
    ]);

    expect(ranked[0].id).toBe('74');
  });

  it('expands common aliases so field jargon does not collapse into no-match', () => {
    const ranked = rankLexicalCandidates('중처법 안전보건 확보의무', [
      {
        id: 'csh',
        lawTitle: '중대재해 처벌 등에 관한 법률',
        articleNumber: '제4조',
        articleHeading: '사업주와 경영책임자등의 안전 및 보건 확보의무',
        articleText: '사업주 또는 경영책임자등은 종사자의 안전ㆍ보건상 유해 또는 위험을 방지하기 위한 조치를 하여야 한다.',
        lexicalScore: 0.55,
      },
      {
        id: 'lsa',
        lawTitle: '산업안전보건법',
        articleNumber: '제15조',
        articleHeading: '안전보건관리책임자',
        articleText: '사업주는 안전보건관리책임자를 두어야 한다.',
        lexicalScore: 0.55,
      },
    ]);

    expect(ranked[0].id).toBe('csh');
  });
});
```

- [x] **Step 2: Run the lexical test to verify it fails**

Run: `npm run test -- tests/unit/lexical-search.test.ts`
Expected: FAIL because `split-articles.ts` and `lexical.ts` do not exist yet.

- [x] **Step 3: Implement article splitting and deterministic lexical reranking**

```ts
// src/lib/law/split-articles.ts
export type ArticleChunk = {
  articleNumber: string;
  articleHeading: string;
  articleText: string;
  articlePath: string;
};

// P0 fix (2026-04-13): 이전 버전은 `[^제]+`로 본문을 캡처해 본문 내 '제' 글자('제1항', 교차인용 '제55조')에서 청크가 산산조각 났다.
// 새 전략:
// 1) 라인 앵커(`m` 플래그 + `^`)로 '줄 맨 앞'의 제N조(의N)?만 헤더로 인정한다.
// 2) 본문은 lazy([\s\S]*?)로 잡고, 다음 헤더 시작(또는 문자열 끝) 직전까지 lookahead로 멈춘다.
// 3) '부칙' 섹션은 조문이 아니라 별도 블록이므로 헤더가 아닌 섹션 경계로 취급해 조문 리스트 뒤에 남지 않게 한다.
const ARTICLE_HEADER = /^(제\d+조(?:의\d+)?)(?:\(([^)]+)\))?/;
const ARTICLE_PATTERN = /^(제\d+조(?:의\d+)?)(?:\(([^)]+)\))?\s*([\s\S]*?)(?=^\s*제\d+조(?:의\d+)?|^\s*부칙\b|\Z)/gm;

export function splitLawArticles(lawTitle: string, bodyMarkdown: string): ArticleChunk[] {
  // 부칙 이후 본문은 조문 추출 대상이 아니다.
  const trimmedBody = bodyMarkdown.split(/^\s*부칙\b/m)[0] ?? '';
  const chunks: ArticleChunk[] = [];

  for (const match of trimmedBody.matchAll(ARTICLE_PATTERN)) {
    const articleNumber = match[1].trim();
    const articleHeading = (match[2]?.trim()) || articleNumber;
    const articleText = (match[3] ?? '').trim();

    if (!articleText) continue;

    chunks.push({
      articleNumber,
      articleHeading,
      articleText,
      articlePath: `${lawTitle} ${articleNumber}`,
    });
  }

  return chunks;
}

export { ARTICLE_HEADER };
```

```ts
// src/lib/law/split-appendices.ts
import type { ArticleChunk } from '@/src/lib/law/split-articles';

export function splitAppendices(
  lawTitle: string,
  appendices: Array<{ label: string; title: string; bodyMarkdown: string }>,
): ArticleChunk[] {
  return appendices
    .filter((appendix) => appendix.bodyMarkdown.trim().length > 0)
    .map((appendix) => ({
      articleNumber: appendix.label,
      articleHeading: appendix.title,
      articleText: appendix.bodyMarkdown.trim(),
      articlePath: `${lawTitle} ${appendix.label}`,
    }));
}
```

```ts
// src/lib/search/lexical.ts
export type LexicalCandidate = {
  id: string;
  lawTitle: string;
  articleNumber: string;
  articleHeading: string;
  articleText: string;
  lexicalScore: number;
};

function tokenize(input: string) {
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function expandAliases(tokens: string[]) {
  const aliasMap: Record<string, string[]> = {
    중처법: ['중대재해', '처벌', '중대재해처벌법'],
    화관법: ['화학물질관리법', '유해화학물질'],
    화평법: ['화학물질등록평가법', '등록평가'],
    산안법: ['산업안전보건법', '안전보건'],
    msds: ['물질안전보건자료'],
  };

  return Array.from(
    new Set(
      tokens.flatMap((token) => [token, ...(aliasMap[token] ?? [])]),
    ),
  );
}

export function rankLexicalCandidates<T extends LexicalCandidate>(query: string, candidates: T[]) {
  const tokens = expandAliases(tokenize(query));

  return [...candidates].sort((left, right) => {
    const score = (candidate: T) => {
      const haystack = `${candidate.lawTitle} ${candidate.articleHeading} ${candidate.articleText}`.toLowerCase();
      const overlap = tokens.filter((token) => haystack.includes(token)).length;
      const headingBoost = tokens.filter((token) => candidate.articleHeading.toLowerCase().includes(token)).length * 0.2;
      return candidate.lexicalScore + overlap * 0.15 + headingBoost;
    };

    return score(right) - score(left);
  });
}
```

- [~] **Step 4: Update the sync script to persist article chunks, then rerun the test and sync** _(script updated; real sync deferred until LAW_OC issued)_

```ts
// scripts/sync-laws.ts (replace the body of the loop)
import { createHash } from 'node:crypto';
import { splitLawArticles } from '@/src/lib/law/split-articles';
import { splitAppendices } from '@/src/lib/law/split-appendices';

// ...inside the for (const law of results) loop:
const detail = await fetchLawDetail(law.lawMst);
const [document] = await db<{
  id: string;
}[]>`
  INSERT INTO law_documents (
    law_mst,
    law_id,
    title,
    normalized_title,
    law_kind,
    ministry,
    promulgated_at,
    source_url,
    body_markdown,
    source_hash,
    updated_at
  )
  VALUES (
    ${law.lawMst},
    ${law.lawId},
    ${law.title},
    ${law.normalizedTitle},
    ${law.lawKind},
    ${law.ministry},
    ${law.promulgatedAt},
    ${law.sourceUrl},
    ${detail.bodyMarkdown},
    ${detail.sourceHash},
    now()
  )
  ON CONFLICT (law_mst)
  DO UPDATE SET
    title = EXCLUDED.title,
    normalized_title = EXCLUDED.normalized_title,
    law_kind = EXCLUDED.law_kind,
    ministry = EXCLUDED.ministry,
    promulgated_at = EXCLUDED.promulgated_at,
    source_url = EXCLUDED.source_url,
    body_markdown = EXCLUDED.body_markdown,
    source_hash = EXCLUDED.source_hash,
    updated_at = now()
  RETURNING id
`;

const articleChunks = splitLawArticles(law.title, detail.bodyMarkdown).map((chunk) => ({
  ...chunk,
  kind: 'article' as const,
}));
const appendixChunks = splitAppendices(law.title, detail.appendices).map((chunk) => ({
  ...chunk,
  kind: 'appendix' as const,
}));
const chunks = [...articleChunks, ...appendixChunks];

for (const chunk of chunks) {
  const contentHash = createHash('sha256').update(chunk.articleText).digest('hex');
  const [article] = await db<{
    id: string;
    content_hash: string;
    version: number;
  }[]>`
    INSERT INTO law_articles (
      document_id,
      kind,
      law_title,
      article_number,
      article_heading,
      article_text,
      article_path,
      effective_from,
      effective_to,
      repealed_at,
      content_hash,
      version
    )
    VALUES (
      ${document.id},
      ${chunk.kind},
      ${law.title},
      ${chunk.articleNumber},
      ${chunk.articleHeading},
      ${chunk.articleText},
      ${chunk.articlePath},
      ${law.effectiveAt ?? law.promulgatedAt ?? '1900-01-01'},
      null,
      null,
      ${contentHash},
      1
    )
    ON CONFLICT (document_id, article_path)
    DO UPDATE SET
      kind = EXCLUDED.kind,
      law_title = EXCLUDED.law_title,
      article_number = EXCLUDED.article_number,
      article_heading = EXCLUDED.article_heading,
      article_text = EXCLUDED.article_text,
      effective_from = EXCLUDED.effective_from,
      effective_to = EXCLUDED.effective_to,
      repealed_at = EXCLUDED.repealed_at,
      content_hash = EXCLUDED.content_hash,
      version = CASE
        WHEN law_articles.content_hash = EXCLUDED.content_hash THEN law_articles.version
        ELSE law_articles.version + 1
      END
    RETURNING id, content_hash, version
  `;

  await db`
    INSERT INTO law_article_versions (
      article_id,
      version,
      article_text,
      effective_from,
      effective_to,
      repealed_at,
      content_hash
    )
    SELECT
      ${article.id},
      ${article.version},
      ${chunk.articleText},
      ${law.effectiveAt ?? law.promulgatedAt ?? '1900-01-01'},
      null,
      null,
      ${contentHash}
    WHERE NOT EXISTS (
      SELECT 1
      FROM law_article_versions
      WHERE article_id = ${article.id}
        AND version = ${article.version}
        AND content_hash = ${contentHash}
    )
  `;
}
```

Run: `npm run test -- tests/unit/lexical-search.test.ts && npm run sync:laws -- --query 근로기준법 --limit 1`
Expected: PASS, then sync output with `upserted 근로기준법`, article rows inserted, and appendix rows/version rows created without duplicating unchanged versions.

- [x] **Step 5: Commit article indexing and lexical ranking**

```bash
git add src/lib/law/split-articles.ts src/lib/law/split-appendices.ts src/lib/search/lexical.ts scripts/sync-laws.ts tests/unit/lexical-search.test.ts
git commit -m "feat: add article chunking and lexical retrieval"
```

### Task 5: Add embeddings and hybrid search scoring

**Scale assumption (must be explicit):** MVP 검색 대상은 산안법 계열 일부가 아니라 대한민국 전체 법령 DB다. 조문 + 별표 청크 수는 수십만 건 이상으로 커질 수 있으므로, 이 작업은 "샘플 몇 천 건" 기준이 아니라 **대용량 벌크 인덱싱** 기준으로 설계해야 한다. 임베딩 모델 차원, pgvector 인덱스 종류, 백필 배치 크기, 재임베딩 시간은 모두 이 규모를 전제로 잡는다.

**Files:**
- Modify: `package.json`
- Create: `src/lib/search/hybrid.ts`
- Create: `scripts/embed-laws.ts`
- Create: `tests/unit/hybrid-search.test.ts`

- [ ] **Step 1: Write the failing hybrid score merge test**

```ts
// tests/unit/hybrid-search.test.ts
import { mergeHybridScores } from '@/src/lib/search/hybrid';

describe('mergeHybridScores', () => {
  it('keeps the strongest lexical hit ahead when vector evidence is weak', () => {
    const merged = mergeHybridScores([
      { id: '74', lexicalScore: 0.92, vectorScore: 0.25 },
      { id: '76', lexicalScore: 0.55, vectorScore: 0.72 },
    ]);

    expect(merged[0]).toMatchObject({
      id: '74',
      combinedScore: expect.any(Number),
    });
  });
});
```

- [ ] **Step 2: Run the hybrid test to verify it fails**

Run: `npm run test -- tests/unit/hybrid-search.test.ts`
Expected: FAIL because `src/lib/search/hybrid.ts` does not exist yet.

- [ ] **Step 3: Add local multilingual embeddings and hybrid score merging**

```json
// package.json (add the new dependency)
{
  "dependencies": {
    "@xenova/transformers": "^2.17.2"
  }
}
```

```ts
// src/lib/search/hybrid.ts
import { pipeline } from '@xenova/transformers';

export type HybridCandidate = {
  id: string;
  lexicalScore: number;
  vectorScore: number;
};

let embedderPromise: Promise<any> | null = null;

function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline('feature-extraction', 'intfloat/multilingual-e5-base');
  }
  return embedderPromise;
}

export async function embedQuery(text: string) {
  const embedder = await getEmbedder();
  const output = await embedder(`query: ${text}`, {
    pooling: 'mean',
    normalize: true,
  });
  return Array.from(output.data as Float32Array);
}

export function mergeHybridScores(candidates: HybridCandidate[]) {
  return [...candidates]
    .map((candidate) => ({
      ...candidate,
      combinedScore: candidate.lexicalScore * 0.65 + candidate.vectorScore * 0.35,
    }))
    .sort((left, right) => right.combinedScore - left.combinedScore);
}
```

- [ ] **Step 4: Add the embedding backfill script and rerun the test**

```ts
// scripts/embed-laws.ts
import { db } from '@/src/lib/db';
import { embedQuery } from '@/src/lib/search/hybrid';

function toVectorLiteral(vector: number[]) {
  return `[${vector.join(',')}]`;
}

async function main() {
  const rows = await db<{
    id: string;
    article_text: string;
  }[]>`
    SELECT id, article_text
    FROM law_articles
    WHERE embedding IS NULL
    ORDER BY created_at ASC
    LIMIT 500
  `;

  for (const row of rows) {
    const vector = await embedQuery(row.article_text);
    await db.unsafe(
      `UPDATE law_articles SET embedding = '${toVectorLiteral(vector)}'::vector WHERE id = '${row.id}'`,
    );
    console.log(`embedded ${row.id}`);
  }

  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
```

Run: `npm install && npm run test -- tests/unit/hybrid-search.test.ts && npm run embed:laws`
Expected: PASS, then output lines such as `embedded <uuid>` for rows that were missing vectors.

**Operational note:** before merge, record a rough bulk-indexing estimate in the task log: number of chunks, average embedding throughput, projected one-time backfill duration, and re-embed duration for a daily delta. If the estimate is not written down, this task is incomplete.

- [ ] **Step 5: Commit hybrid retrieval support**

```bash
git add package.json package-lock.json src/lib/search/hybrid.ts scripts/embed-laws.ts tests/unit/hybrid-search.test.ts
git commit -m "feat: add hybrid retrieval scoring"
```

### Task 6: Implement the clarification gate and source-bounded answer generator (via Codex daemon)

**Engine adapter prerequisite.** Before this task, the Mac mini must have `codex mcp-server` running under launchd, and the Node.js daemon (`scripts/codex-daemon.ts`) must be listening on `CODEX_DAEMON_URL`. The daemon exposes `POST /generate` accepting `{ sessionId?, prompt, schema }` and returning `{ sessionId, response }` where `response` conforms to the supplied JSON Schema. The web-app side consumes this through `src/lib/assistant/engine/` (adapter pattern) so the Codex implementation can be swapped for `engine/anthropic.ts` without touching any other file. Tests mock the adapter, not the HTTP client.

**Law MCP prerequisite.** `LAW_MCP_URL` must point at a reachable `korean-law-mcp` server. This task does not use it directly, but the citation-verification step added in Task 7 does. Tests mock `src/lib/open-law/mcp-client.ts`.

**Hard guards added in this task:**
- `guardrails.ts` — refuses engine calls when citations are empty; auto-downgrades strength when any cited article is not in force at query time.
- `generate.ts` — on `--output-schema` validation failure, retries once; second failure returns a structured error surfaced to the UI as "생성 오류 — 다시 시도해 주세요". No free-text fallback.

**Files:**
- Create: `src/lib/assistant/types.ts`
- Create: `src/lib/assistant/clarify.ts`
- Create: `src/lib/assistant/prompt.ts`
- Create: `src/lib/assistant/schemas/answer.schema.json`
- Create: `src/lib/assistant/engine/types.ts`
- Create: `src/lib/assistant/engine/codex.ts`
- Create: `src/lib/assistant/engine/anthropic.ts`
- Create: `src/lib/assistant/engine/index.ts`
- Create: `src/lib/assistant/guardrails.ts`
- Create: `src/lib/assistant/generate.ts`
- Create: `tests/unit/clarify.test.ts`
- Create: `tests/unit/generate.test.ts`
- Create: `tests/unit/guardrails.test.ts`
- Create: `tests/unit/codex-engine.test.ts`

- [ ] **Step 1: Write the failing clarification and prompt tests**

```ts
// tests/unit/clarify.test.ts
import { getDateHintMessage, needsDateConfirmation, planAssistantAction } from '@/src/lib/assistant/clarify';

describe('planAssistantAction', () => {
  it('asks a question only when the top results are weak and cross multiple laws', () => {
    const decision = planAssistantAction('야간근로 기준이 뭐야?', '2026-04-14', [
      {
        id: '1',
        lawTitle: '근로기준법',
        articleNumber: '제74조',
        articleVersionId: 'v1',
        quote: '임산부 야간근로',
        combinedScore: 0.51,
        effectiveFrom: '2025-01-01',
        effectiveTo: null,
        repealedAt: null,
      },
      {
        id: '2',
        lawTitle: '산업안전보건법',
        articleNumber: '제41조',
        articleVersionId: 'v2',
        quote: '작업중지',
        combinedScore: 0.48,
        effectiveFrom: '2025-01-01',
        effectiveTo: null,
        repealedAt: null,
      },
    ]);

    expect(decision.kind).toBe('clarify');
    expect(decision.question).toContain('기준 시점');
  });

  it('asks for explicit date confirmation when the query mentions a past point in time', () => {
    const decision = planAssistantAction('2024년 3월 사고 당시 이 조치 의무가 있었나?', '2026-04-14', [
      {
        id: '1',
        lawTitle: '산업안전보건법',
        articleNumber: '제36조',
        articleVersionId: 'v1',
        quote: '사업주는 위험성평가를 실시하여야 한다.',
        combinedScore: 0.88,
        effectiveFrom: '2025-01-01',
        effectiveTo: null,
        repealedAt: null,
      },
    ]);

    expect(decision.kind).toBe('clarify');
    expect(decision.question).toContain('2024년 3월');
  });

  it('requires explicit client confirmation when a past-time hint conflicts with today', () => {
    expect(needsDateConfirmation('사고 당시 의무가 있었나?', new Date().toISOString().slice(0, 10))).toBe(true);
    expect(getDateHintMessage('사고 당시 의무가 있었나?', new Date().toISOString().slice(0, 10))).toContain('기준 시점');
  });
});
```

```ts
// tests/unit/generate.test.ts
import { buildAnswerPrompt } from '@/src/lib/assistant/prompt';

describe('buildAnswerPrompt', () => {
  it('forbids unsupported claims and includes citation payloads', () => {
    const prompt = buildAnswerPrompt({
      query: '임산부 야간근로가 가능한가?',
      strength: 'conditional',
      citations: [
        {
          lawTitle: '근로기준법',
          articleNumber: '제74조',
          articleVersionId: 'v1',
          quote: '사용자는 임신 중의 여성을 야간근로에 사용하지 못한다.',
          combinedScore: 0.9,
          effectiveFrom: '2025-01-01',
          effectiveTo: null,
          repealedAt: null,
        },
      ],
    });

    expect(prompt).toContain('근거로 제공된 조문만 사용하라');
    expect(prompt).toContain('근로기준법 제74조');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/unit/clarify.test.ts tests/unit/generate.test.ts tests/unit/guardrails.test.ts tests/unit/codex-engine.test.ts`
Expected: FAIL because the assistant files do not exist yet.

- [ ] **Step 3: Implement the assistant contracts and clarification rules**

```ts
// src/lib/assistant/types.ts
export type CitationInput = {
  id: string;
  lawTitle: string;
  articleNumber: string;
  articleVersionId: string;
  kind?: 'article' | 'appendix';
  quote: string;
  combinedScore: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  repealedAt: string | null;
  verificationSource?: 'local' | 'mcp';
  mcpDisagreement?: boolean;
};

export type ClarifyDecision =
  | { kind: 'clarify'; question: string }
  | { kind: 'answer'; strength: 'clear' | 'conditional' }
  | { kind: 'no_match' };
```

```ts
// src/lib/assistant/clarify.ts
import type { CitationInput, ClarifyDecision } from '@/src/lib/assistant/types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function needsDateConfirmation(query: string, queryEffectiveDate: string) {
  const explicitDateMatch = query.match(/(20\d{2})[.\-/년]\s*(\d{1,2})(?:[.\-/월]\s*(\d{1,2}))?/);
  if (explicitDateMatch) {
    const [, year, month, day] = explicitDateMatch;
    const normalized =
      day != null
        ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
        : `${year}-${month.padStart(2, '0')}`;
    return !queryEffectiveDate.startsWith(normalized);
  }

  if (/(지난달|사고 당시|계약 당시|점검 당시|개정 전|당시)/.test(query)) {
    return queryEffectiveDate === todayIso();
  }

  return false;
}

export function getDateHintMessage(query: string, queryEffectiveDate: string) {
  const explicitDateMatch = query.match(/(20\d{2})[.\-/년]\s*(\d{1,2})(?:[.\-/월]\s*(\d{1,2}))?/);
  if (explicitDateMatch) {
    const [, year, month, day] = explicitDateMatch;
    const normalized =
      day != null
        ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
        : `${year}-${month.padStart(2, '0')}`;
    if (!queryEffectiveDate.startsWith(normalized)) {
      return `질문에 ${year}년 ${month}월 시점이 보입니다. 기준 시점을 다시 확인해 주세요.`;
    }
  }

  if (/(지난달|사고 당시|계약 당시|점검 당시|개정 전|당시)/.test(query) && queryEffectiveDate === todayIso()) {
    return '질문에 상대 시점 표현이 있습니다. today 기준 답으로 오해하지 않도록 기준 시점을 다시 확인해 주세요.';
  }

  return null;
}

export function planAssistantAction(
  query: string,
  queryEffectiveDate: string,
  candidates: CitationInput[],
): ClarifyDecision {
  if (candidates.length === 0) {
    return { kind: 'no_match' };
  }

  const top = candidates[0];
  const second = candidates[1];
  const uniqueLaws = new Set(candidates.slice(0, 3).map((item) => item.lawTitle)).size;
  const hasNumber = /\d/.test(query);
  const mentionsThreshold = candidates
    .slice(0, 3)
    .some((item) => /(미터|명|일|개월|만원|퍼센트)/.test(item.quote));
  const dateHint = getDateHintMessage(query, queryEffectiveDate);

  if (dateHint) {
    return {
      kind: 'clarify',
      question: dateHint,
    };
  }

  if (top.combinedScore < 0.55) {
    return {
      kind: 'clarify',
      question: `기준 시점(${queryEffectiveDate})과 작업 또는 문서 상황을 조금만 더 구체적으로 설명해 주세요.`,
    };
  }

  if (second && top.combinedScore - second.combinedScore < 0.08 && uniqueLaws > 1) {
    return {
      kind: 'clarify',
      question: '어떤 작업을 기준으로 보려는지, 그리고 사업장 맥락이 무엇인지 알려주세요.',
    };
  }

  if (!hasNumber && mentionsThreshold && uniqueLaws > 1) {
    return {
      kind: 'clarify',
      question: '높이, 인원, 기간처럼 판단에 필요한 수치를 알려주실 수 있나요?',
    };
  }

  return {
    kind: 'answer',
    strength: top.combinedScore >= 0.78 ? 'clear' : 'conditional',
  };
}
```

- [ ] **Step 4: Implement the prompt builder, Codex daemon client, and generate() — then rerun the tests**

```ts
// src/lib/assistant/prompt.ts
import type { CitationInput } from '@/src/lib/assistant/types';

export function buildAnswerPrompt(input: {
  query: string;
  strength: 'clear' | 'conditional';
  citations: CitationInput[];
}) {
  const citationBlock = input.citations
    .map(
      (citation, index) =>
        `${index + 1}. ${citation.lawTitle} ${citation.articleNumber}\n${citation.quote}`,
    )
    .join('\n\n');

  return [
    '근거로 제공된 조문만 사용하라.',
    '근거에 없는 결론, 판례, 예외는 만들어내지 마라.',
    '먼저 직접 확인된 사실을 2~5개로 요약하고, 그 다음에 판단을 적어라.',
    '질문이 여러 쟁점을 포함하면 답한 범위와 아직 답하지 못한 범위를 분리하라.',
    '복수 법령이 함께 적용되면 법령별 섹션으로 나누고, 각 섹션은 자기 근거만 사용하라.',
    '복수 법령이면 사용자가 무엇부터 확인해야 하는지 우선 판단 순서를 적어라.',
    'lawSections는 우선순위가 높은 항목만 최대 6개까지 작성하고, 그 외는 caution 또는 explanation에서 요약하라.',
    '접힌 나머지 법령이 있다면 collapsedLawSummary에 "법령명 + 추가 쟁점" 형식의 한 줄 요약을 넣어라.',
    '반드시 제공된 JSON Schema에 부합하는 구조로 답하라.',
    `질문: ${input.query}`,
    `답변 강도: ${input.strength}`,
    `근거:\n${citationBlock}`,
  ].join('\n\n');
}
```

```json
// src/lib/assistant/schemas/answer.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["verifiedFacts", "conclusion", "explanation", "caution"],
  "properties": {
    "conclusion":  { "type": "string", "minLength": 1 },
    "explanation": { "type": "string", "minLength": 1 },
    "caution":     { "type": "string", "minLength": 1 },
    "verifiedFacts": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "answeredScope": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "unansweredScope": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "priorityOrder": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    },
    "collapsedLawSummary": {
      "type": "string"
    },
    "lawSections": {
      "type": "array",
      "maxItems": 6,
      "items": {
        "type": "object",
        "required": ["lawTitle", "summary"],
        "properties": {
          "lawTitle": { "type": "string", "minLength": 1 },
          "summary": { "type": "string", "minLength": 1 },
          "whyItApplies": { "type": "string" },
          "checkFirst": {
            "type": "array",
            "items": { "type": "string", "minLength": 1 }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

```ts
// src/lib/assistant/engine/types.ts
export type EngineGenerateParams = {
  sessionId?: string;
  prompt: string;
  schema: object;
};

export type EngineGenerateResult<T> = {
  sessionId: string;
  response: T;
};
```

```ts
// src/lib/assistant/engine/codex.ts
import { env } from '@/src/lib/env';
import type { EngineGenerateParams, EngineGenerateResult } from '@/src/lib/assistant/engine/types';

export async function generateWithCodex<T>(
  params: EngineGenerateParams,
): Promise<EngineGenerateResult<T>> {
  if (!env.CODEX_DAEMON_URL) {
    throw new Error('CODEX_DAEMON_URL is not configured');
  }

  const res = await fetch(`${env.CODEX_DAEMON_URL}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(`Codex daemon error ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as EngineGenerateResult<T>;
}
```

```ts
// src/lib/assistant/engine/index.ts
import { env } from '@/src/lib/env';
import { generateWithCodex } from '@/src/lib/assistant/engine/codex';

export const engine = {
  generate: generateWithCodex,
  provider: env.ENGINE_PROVIDER,
};
```

```ts
// src/lib/assistant/guardrails.ts
import type { CitationInput } from '@/src/lib/assistant/types';

export function assertEvidenceExists(citations: CitationInput[]) {
  if (citations.length === 0) {
    return { ok: false as const, status: 'no_match' as const };
  }

  return { ok: true as const };
}
```

```ts
// src/lib/assistant/generate.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { engine } from '@/src/lib/assistant/engine';
import { buildAnswerPrompt } from '@/src/lib/assistant/prompt';
import type { CitationInput } from '@/src/lib/assistant/types';

const answerZod = z.object({
  conclusion: z.string().min(1),
  explanation: z.string().min(1),
  caution: z.string().min(1),
  verifiedFacts: z.array(z.string().min(1)).default([]),
  answeredScope: z.array(z.string().min(1)).default([]),
  unansweredScope: z.array(z.string().min(1)).default([]),
  priorityOrder: z.array(z.string().min(1)).default([]),
  collapsedLawSummary: z.string().optional(),
  lawSections: z
    .array(
      z.object({
        lawTitle: z.string().min(1),
        summary: z.string().min(1),
        whyItApplies: z.string().optional(),
        checkFirst: z.array(z.string().min(1)).default([]),
      }),
    )
    .max(6)
    .default([]),
});

const answerSchema = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'src/lib/assistant/schemas/answer.schema.json'),
    'utf8',
  ),
);

export async function generateAnswer(input: {
  query: string;
  strength: 'clear' | 'conditional';
  citations: CitationInput[];
  sessionId?: string;
  queryEffectiveDate: string;
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let sessionId = input.sessionId ?? '';
    let response: unknown;

    try {
      const result = await engine.generate<unknown>({
        sessionId: input.sessionId,
        prompt: buildAnswerPrompt({
          query: `${input.query}\n기준 시점: ${input.queryEffectiveDate}`,
          strength: input.strength,
          citations: input.citations,
        }),
        schema: answerSchema,
      });
      sessionId = result.sessionId;
      response = result.response;
    } catch {
      return {
        sessionId,
        error: 'engine_error' as const,
        message: '생성 엔진에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        schemaRetryCount: attempt,
      };
    }

    const parsed = answerZod.safeParse(response);
    if (parsed.success) {
      return { sessionId, answer: parsed.data, schemaRetryCount: attempt };
    }
  }

  return {
    sessionId: input.sessionId ?? '',
    error: 'schema_error' as const,
    message: '생성 오류 — 다시 시도해 주세요.',
    schemaRetryCount: 2,
  };
}
```

For `tests/unit/generate.test.ts`, `tests/unit/guardrails.test.ts`, and `tests/unit/codex-engine.test.ts`: mock the engine adapter and assert that (a) empty citations never call the engine, (b) schema parse failure retries once, (c) the second failure returns `schema_error` rather than throwing a raw exception or rendering free text, and (d) daemon/network failure returns `engine_error` as a structured UI-safe state.

Run: `npm run test -- tests/unit/clarify.test.ts tests/unit/generate.test.ts tests/unit/guardrails.test.ts tests/unit/codex-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the assistant decision layer**

```bash
git add src/lib/assistant tests/unit/clarify.test.ts tests/unit/generate.test.ts tests/unit/guardrails.test.ts tests/unit/codex-engine.test.ts
git commit -m "feat: add clarification policy and answer generation"
```

### Task 7: Build the orchestration route, persistence, and history API

**Files:**
- Create: `src/lib/history.ts`
- Create: `src/lib/assistant/run-query.ts`
- Create: `src/lib/auth/session.ts`
- Create: `app/api/ask/route.ts`
- Create: `app/api/history/route.ts`
- Create: `app/api/history/[runId]/route.ts`
- Create: `scripts/seed-dev.ts`
- Create: `tests/unit/api-ask-route.test.ts`

- [ ] **Step 1: Write the failing `/api/ask` route test**

```ts
// tests/unit/api-ask-route.test.ts
import { POST } from '@/app/api/ask/route';

vi.mock('@/src/lib/auth/session', () => ({
  requireCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', email: 'safety@example.com' }),
}));

vi.mock('@/src/lib/assistant/run-query', () => ({
  runAssistantQuery: vi.fn().mockResolvedValue({
    type: 'clarify',
    question: '작업 높이를 알려주세요.',
  }),
}));

describe('POST /api/ask', () => {
  it('returns the assistant payload as JSON', async () => {
    const request = new Request('http://localhost/api/ask', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'ask',
        query: '비계 설치 자격이 필요해?',
        effectiveDate: '2026-04-14',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      type: 'clarify',
      question: '작업 높이를 알려주세요.',
    });
  });
});
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npm run test -- tests/unit/api-ask-route.test.ts`
Expected: FAIL because the route files do not exist yet.

- [ ] **Step 3: Implement history access and the orchestration pipeline**

```ts
// src/lib/history.ts
import { db } from '@/src/lib/db';

export async function listRecentRuns(userId: string, limit = 10) {
  return db<{
    id: string;
    user_query: string;
    query_effective_date: string;
    status: 'clarify' | 'answered' | 'no_match' | 'schema_error' | 'engine_error' | 'canceled';
    answer_strength: 'clear' | 'conditional' | 'verification_pending' | null;
    conclusion: string | null;
    clarification_question: string | null;
    changed_since_created: boolean;
    answer_behavior_version: string;
    created_at: string;
  }[]>`
    SELECT id, user_query, query_effective_date, status, answer_strength, conclusion, clarification_question, changed_since_created, answer_behavior_version, created_at
    FROM assistant_runs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getRunSnapshot(userId: string, runId: string) {
  const [run] = await db<{
    id: string;
    user_query: string;
    query_effective_date: string;
    status: 'clarify' | 'answered' | 'no_match' | 'schema_error' | 'engine_error' | 'canceled';
    answer_strength: 'clear' | 'conditional' | 'verification_pending' | null;
    conclusion: string | null;
    explanation: string | null;
    caution: string | null;
    changed_since_created: boolean;
    answer_behavior_version: string;
    created_at: string;
  }[]>`
    SELECT
      id,
      user_query,
      query_effective_date,
      status,
      answer_strength,
      conclusion,
      explanation,
      caution,
      changed_since_created,
      answer_behavior_version,
      created_at
    FROM assistant_runs
    WHERE id = ${runId}
      AND user_id = ${userId}
  `;

  const citations = await db<{
    article_id: string;
    article_version_id: string;
    quote: string;
    position: number;
    verification_source: 'local' | 'mcp';
    mcp_disagreement: boolean;
    changed_summary: string | null;
  }[]>`
    SELECT
      article_id,
      article_version_id,
      quote,
      position,
      verification_source,
      mcp_disagreement,
      changed_summary
    FROM assistant_run_citations
    WHERE run_id = ${runId}
    ORDER BY position ASC
  `;

  return run ? { ...run, citations } : null;
}
```

```ts
// src/lib/assistant/run-query.ts
import { db } from '@/src/lib/db';
import { assertEvidenceExists } from '@/src/lib/assistant/guardrails';
import { generateAnswer } from '@/src/lib/assistant/generate';
import { planAssistantAction } from '@/src/lib/assistant/clarify';
import { verifyCitations } from '@/src/lib/assistant/verify-citations';
import { embedQuery, mergeHybridScores } from '@/src/lib/search/hybrid';
import { rankLexicalCandidates } from '@/src/lib/search/lexical';

function toVectorLiteral(vector: number[]) {
  return `[${vector.join(',')}]`;
}

export async function runAssistantQuery(params: {
  userId: string;
  query: string;
  effectiveDate: string;
  clientRequestId?: string;
  referenceDateConfirmed?: boolean;
  skipClarification?: boolean;
  rerunFromRunId?: string;
  sessionId?: string;
}) {
  const ANSWER_BEHAVIOR_VERSION = '2026-04-14';
  const queryVector = toVectorLiteral(await embedQuery(params.query));
  const rows = await db<{
    id: string;
    article_version_id: string;
    law_title: string;
    article_number: string;
    article_text: string;
    lexical_score: number;
    vector_score: number | null;
    effective_from: string;
    effective_to: string | null;
    repealed_at: string | null;
  }[]>`
    SELECT
      law_articles.id,
      version_row.id AS article_version_id,
      law_articles.law_title,
      law_articles.article_number,
      law_articles.article_text,
      ts_rank_cd(law_articles.search_vector, websearch_to_tsquery('simple', ${params.query})) AS lexical_score,
      (1 - (law_articles.embedding <=> ${queryVector}::vector)) AS vector_score,
      law_articles.effective_from,
      law_articles.effective_to,
      law_articles.repealed_at
    FROM law_articles
    JOIN law_article_versions AS version_row
      ON version_row.article_id = law_articles.id
     AND version_row.version = law_articles.version
    WHERE law_articles.search_vector @@ websearch_to_tsquery('simple', ${params.query})
      AND law_articles.effective_from <= ${params.effectiveDate}
      AND (law_articles.effective_to IS NULL OR ${params.effectiveDate} <= law_articles.effective_to)
      AND law_articles.repealed_at IS NULL
    ORDER BY lexical_score DESC
    LIMIT 24
  `;

  const lexical = rankLexicalCandidates(
    params.query,
    rows.map((row) => ({
      id: row.id,
      kind: row.article_number.startsWith('별표') ? 'appendix' : 'article',
      lawTitle: row.law_title,
      articleNumber: row.article_number,
      articleHeading: row.article_number,
      articleText: row.article_text,
      lexicalScore: Number(row.lexical_score),
      vector_score: row.vector_score,
      article_version_id: row.article_version_id,
      effective_from: row.effective_from,
      effective_to: row.effective_to,
      repealed_at: row.repealed_at,
    })),
  );

  const candidates = mergeHybridScores(
    lexical.slice(0, 5).map((row: any) => ({
      id: row.id,
      lexicalScore: row.lexicalScore,
      vectorScore: Number(row.vector_score ?? 0),
    })),
  ).map((scored) => {
    const source = lexical.find((row) => row.id === scored.id)!;
    return {
      id: scored.id,
      articleVersionId: source.article_version_id,
      lawTitle: source.lawTitle,
      articleNumber: source.articleNumber,
      quote: source.articleText.slice(0, 240),
      combinedScore: scored.combinedScore,
      effectiveFrom: source.effective_from,
      effectiveTo: source.effective_to,
      repealedAt: source.repealed_at,
    };
  });

  const evidence = assertEvidenceExists(candidates.slice(0, 3));
  if (!evidence.ok) {
    await db`
      INSERT INTO assistant_runs (user_id, rerun_from_run_id, client_request_id, user_query, normalized_query, query_effective_date, status, answer_behavior_version, reference_date_confirmed, engine_provider)
      VALUES (${params.userId}, ${params.rerunFromRunId ?? null}, ${params.clientRequestId ?? null}, ${params.query}, ${params.query.trim().toLowerCase()}, ${params.effectiveDate}, 'no_match', ${ANSWER_BEHAVIOR_VERSION}, ${params.referenceDateConfirmed ?? false}, 'codex')
    `;

    return {
      type: 'no_match' as const,
      message: '관련 법령을 바로 특정하지 못했습니다. 법적 의무가 없다는 뜻은 아니므로 표현을 바꾸거나 기준 시점을 다시 확인해 주세요.',
    };
  }

  const decision = planAssistantAction(params.query, params.effectiveDate, candidates);

  if (decision.kind === 'clarify' && !params.skipClarification) {
    await db`
      INSERT INTO assistant_runs (user_id, rerun_from_run_id, client_request_id, user_query, normalized_query, query_effective_date, status, clarification_question, answer_behavior_version, reference_date_confirmed, engine_provider)
      VALUES (${params.userId}, ${params.rerunFromRunId ?? null}, ${params.clientRequestId ?? null}, ${params.query}, ${params.query.trim().toLowerCase()}, ${params.effectiveDate}, 'clarify', ${decision.question}, ${ANSWER_BEHAVIOR_VERSION}, ${params.referenceDateConfirmed ?? false}, 'codex')
    `;

    return { type: 'clarify' as const, question: decision.question };
  }

  if (decision.kind === 'no_match') {
    await db`
      INSERT INTO assistant_runs (user_id, rerun_from_run_id, client_request_id, user_query, normalized_query, query_effective_date, status, answer_behavior_version, reference_date_confirmed, engine_provider)
      VALUES (${params.userId}, ${params.rerunFromRunId ?? null}, ${params.clientRequestId ?? null}, ${params.query}, ${params.query.trim().toLowerCase()}, ${params.effectiveDate}, 'no_match', ${ANSWER_BEHAVIOR_VERSION}, ${params.referenceDateConfirmed ?? false}, 'codex')
    `;

    return {
      type: 'no_match' as const,
      message: '관련 법령을 바로 특정하지 못했습니다. 법적 의무가 없다는 뜻은 아니므로 표현을 바꾸거나 기준 시점을 다시 확인해 주세요.',
    };
  }

  const selectedStrength = decision.kind === 'answer' ? decision.strength : 'conditional';

  const verified = await verifyCitations({
    queryEffectiveDate: params.effectiveDate,
    citations: candidates.slice(0, 3),
  });

  const answer = await generateAnswer({
    query: params.query,
    queryEffectiveDate: params.effectiveDate,
    strength: verified.strength ?? selectedStrength,
    citations: verified.citations,
    sessionId: params.sessionId,
  });

  if ('error' in answer) {
    await db`
      INSERT INTO assistant_runs (
        user_id,
        rerun_from_run_id,
        client_request_id,
        user_query,
        normalized_query,
        query_effective_date,
        status,
        answer_behavior_version,
        reference_date_confirmed,
        engine_provider,
        schema_retry_count
      )
      VALUES (
        ${params.userId},
        ${params.rerunFromRunId ?? null},
        ${params.clientRequestId ?? null},
        ${params.query},
        ${params.query.trim().toLowerCase()},
        ${params.effectiveDate},
        ${answer.error === 'engine_error' ? 'engine_error' : 'schema_error'},
        ${ANSWER_BEHAVIOR_VERSION},
        ${params.referenceDateConfirmed ?? false},
        'codex',
        ${answer.schemaRetryCount}
      )
    `;

    return { type: answer.error, message: answer.message };
  }

  return db.begin(async (tx) => {
    const [run] = await tx<{
      id: string;
    }[]>`
      INSERT INTO assistant_runs (
        user_id,
        rerun_from_run_id,
        client_request_id,
        user_query,
        normalized_query,
        query_effective_date,
        status,
        answer_strength,
        conclusion,
        explanation,
        caution,
        changed_since_created,
        answer_behavior_version,
        reference_date_confirmed,
        engine_provider,
        schema_retry_count
      )
      VALUES (
        ${params.userId},
        ${params.rerunFromRunId ?? null},
        ${params.clientRequestId ?? null},
        ${params.query},
        ${params.query.trim().toLowerCase()},
        ${params.effectiveDate},
        'answered',
        ${verified.strength ?? selectedStrength},
        ${answer.answer.conclusion},
        ${answer.answer.explanation},
        ${answer.answer.caution},
        false,
        ${ANSWER_BEHAVIOR_VERSION},
        ${params.referenceDateConfirmed ?? false},
        'codex',
        ${answer.schemaRetryCount}
      )
      RETURNING id
    `;

    for (const [index, citation] of verified.citations.entries()) {
      await tx`
        INSERT INTO assistant_run_citations (
          run_id,
          article_id,
          article_version_id,
          quote,
          position,
          verified_at_mcp,
          verification_source,
          mcp_disagreement,
          latest_article_version_id,
          changed_summary,
          changed_at
        )
        VALUES (
          ${run.id},
          ${citation.id},
          ${citation.articleVersionId},
          ${citation.quote},
          ${index + 1},
          now(),
          ${citation.verificationSource},
          ${citation.mcpDisagreement ?? false},
          ${(citation as any).latestArticleVersionId ?? null},
          ${(citation as any).changedSummary ?? null},
          ${(citation as any).changedSummary ? new Date().toISOString() : null}
        )
      `;
    }

    return {
      type: 'answer' as const,
      sessionId: answer.sessionId,
      query: params.query,
      effectiveDate: params.effectiveDate,
      generatedFromSkip: Boolean(params.skipClarification),
      strength: verified.strength ?? selectedStrength,
      verifiedFacts: answer.answer.verifiedFacts,
      conclusion: answer.answer.conclusion,
      explanation: answer.answer.explanation,
      caution: answer.answer.caution,
      answeredScope: answer.answer.answeredScope,
      unansweredScope: answer.answer.unansweredScope,
      priorityOrder: answer.answer.priorityOrder,
      collapsedLawSummary: answer.answer.collapsedLawSummary,
      lawSections: answer.answer.lawSections,
      citations: verified.citations,
      answerBehaviorVersion: ANSWER_BEHAVIOR_VERSION,
    };
  });
}
```

- [ ] **Step 4: Add the API routes and dev seed script, then rerun the test**

```ts
// app/api/ask/route.ts
import { z } from 'zod';
import { requireCurrentUser } from '@/src/lib/auth/session';
import { needsDateConfirmation } from '@/src/lib/assistant/clarify';
import { runAssistantQuery } from '@/src/lib/assistant/run-query';
import { getRunSnapshot } from '@/src/lib/history';

const bodySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('ask'),
    query: z.string().min(1),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    clientRequestId: z.string().uuid().optional(),
    referenceDateConfirmed: z.boolean().optional(),
    skipClarification: z.boolean().optional(),
  }),
  z.object({
    mode: z.literal('rerun_current_law'),
    runId: z.string().uuid(),
  }),
]);

export async function POST(request: Request) {
  const user = await requireCurrentUser(request);
  const body = bodySchema.parse(await request.json());

  if (body.mode === 'ask' && needsDateConfirmation(body.query, body.effectiveDate) && !body.referenceDateConfirmed) {
    return Response.json(
      { type: 'date_confirmation_required', message: '기준 시점 확인이 필요합니다. 날짜를 수정하거나 현재 기준일로 답변받겠다는 확인을 완료해 주세요.' },
      { status: 400 },
    );
  }

  if (body.mode === 'rerun_current_law') {
    const snapshot = await getRunSnapshot(user.id, body.runId);
    if (!snapshot) {
      return Response.json(
        { type: 'not_found', message: '다시 답변할 원본 이력을 찾지 못했습니다.' },
        { status: 404 },
      );
    }

    const today = new Date().toISOString().slice(0, 10);
    const result = await runAssistantQuery({
      userId: user.id,
      query: snapshot.user_query,
      effectiveDate: today,
      rerunFromRunId: body.runId,
      referenceDateConfirmed: true,
    });
    return Response.json(result);
  }

  const result = await runAssistantQuery({
    userId: user.id,
    query: body.query,
    effectiveDate: body.effectiveDate,
    clientRequestId: body.clientRequestId,
    referenceDateConfirmed: body.referenceDateConfirmed ?? false,
    skipClarification: body.skipClarification ?? false,
  });
  return Response.json(result);
}
```

In the real route implementation, wrap the handler with per-user rate limiting and structured logging. A request that hits the rate-limit bucket must return a UI-safe 429 payload rather than a generic framework error page. Auth expiry, rate-limit, engine timeout, MCP timeout, and queue-over-capacity 503 should each return distinct JSON response variants so the UI can render the correct recovery card.
The real request pipeline should also expose **stage progress** for the active ask request, either via streaming fetch / SSE or an equivalent progress channel. Recommended stage names: `queued`, `retrieving`, `verifying`, `generating`, `finalizing`. If deployment constraints prevent live stage events, the client must fall back to an indeterminate skeleton and stage label without pretending to know a numeric percent.
The same route should accept a `clientRequestId` (or equivalent) so duplicate submits of the same draft can be de-duplicated server-side. If an identical request is already running, the server should return the existing request identity and current stage instead of starting a second run.
If the client aborts a request after the server has already accepted it, the persisted run should be marked `canceled` rather than disappearing silently.
Date hints shown near the form must be generated by deterministic parsing rules for explicit date formats only. The route may validate or echo these hints, but it must not silently overwrite `effectiveDate` based on an LLM guess.

```ts
// app/api/history/route.ts
import { requireCurrentUser } from '@/src/lib/auth/session';
import { listRecentRuns } from '@/src/lib/history';

export async function GET(request: Request) {
  const user = await requireCurrentUser(request);
  const history = await listRecentRuns(user.id, 12);
  return Response.json({ history });
}
```

```ts
// app/api/history/[runId]/route.ts
import { requireCurrentUser } from '@/src/lib/auth/session';
import { getRunSnapshot } from '@/src/lib/history';

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const user = await requireCurrentUser(request);
  const { runId } = await context.params;
  const snapshot = await getRunSnapshot(user.id, runId);

  if (!snapshot) {
    return Response.json(
      { type: 'not_found', message: '해당 답변 이력을 찾지 못했습니다.' },
      { status: 404 },
    );
  }

  return Response.json({ snapshot });
}
```

```ts
// scripts/seed-dev.ts
import { db } from '@/src/lib/db';

async function main() {
  const [user] = await db<{ id: string }[]>`
    INSERT INTO app_users (email)
    VALUES ('safety@example.com')
    ON CONFLICT (email)
    DO UPDATE SET email = EXCLUDED.email
    RETURNING id
  `;

  const [document] = await db<{
    id: string;
  }[]>`
    INSERT INTO law_documents (
      law_mst,
      law_id,
      title,
      normalized_title,
      law_kind,
      ministry,
      source_url,
      body_markdown,
      source_hash
    )
    VALUES (
      'seed-1',
      'seed-1',
      '근로기준법',
      '근로기준법',
      '법률',
      '고용노동부',
      'https://www.law.go.kr/법령/근로기준법',
      '제74조(임산부의 보호) 사용자는 임신 중의 여성을 야간근로에 사용하지 못한다.',
      'seed-hash-1'
    )
    ON CONFLICT (law_mst)
    DO UPDATE SET title = EXCLUDED.title
    RETURNING id
  `;

  await db`
    INSERT INTO law_articles (
      document_id,
      kind,
      law_title,
      article_number,
      article_heading,
      article_text,
      article_path,
      effective_from,
      effective_to,
      repealed_at,
      content_hash,
      version
    )
    VALUES (
      ${document.id},
      'article',
      '근로기준법',
      '제74조',
      '임산부의 보호',
      '사용자는 임신 중의 여성을 야간근로에 사용하지 못한다.',
      '근로기준법 제74조',
      '2025-01-01',
      null,
      null,
      'seed-article-hash-1',
      1
    )
    ON CONFLICT (document_id, article_path)
    DO UPDATE SET article_text = EXCLUDED.article_text
  `;

  await db.end();
}

main().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
```

Run: `npm run test -- tests/unit/api-ask-route.test.ts && npm run seed:dev`
Expected: PASS, then the seed script exits cleanly with no SQL errors.

- [ ] **Step 5: Commit the orchestration and persistence layer**

```bash
git add app/api src/lib/history.ts src/lib/assistant/run-query.ts scripts/seed-dev.ts tests/unit/api-ask-route.test.ts
git commit -m "feat: add ask route and answer history persistence"
```

### Task 8: Build the desktop-first UI and end-to-end flow tests

**Files:**
- Create: `src/components/question-form.tsx`
- Create: `src/components/answer-card.tsx`
- Create: `src/components/clarification-card.tsx`
- Create: `src/components/history-list.tsx`
- Create: `src/components/history-snapshot-panel.tsx`
- Create: `src/components/recovery-card.tsx`
- Create: `src/components/feedback-buttons.tsx`
- Create: `src/components/app-shell.tsx`
- Create: `src/lib/service-updates.ts`
- Modify: `app/page.tsx`
- Create: `tests/unit/app-shell.test.tsx`
- Create: `tests/e2e/ask-flow.spec.ts`

- [ ] **Step 1: Write the failing app-shell rendering test**

```tsx
// tests/unit/app-shell.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { AppShell } from '@/src/components/app-shell';

describe('AppShell', () => {
  it('renders the question form and recent history heading', () => {
    render(<AppShell initialHistory={[]} />);

    expect(screen.getByRole('heading', { name: '이 앱을 이렇게 사용하세요' })).toBeInTheDocument();
    expect(screen.getByText(/최근 업데이트:/)).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: '법령 질문 입력' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('기준 시점')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '최근 질문' })).toBeInTheDocument();
  });

  it('blocks submit until reference-date confirmation is checked for a past-time hint', () => {
    render(<AppShell initialHistory={[]} />);

    fireEvent.change(screen.getByRole('textbox', { name: '법령 질문 입력' }), {
      target: { value: '사고 당시 이 조치 의무가 있었나?' },
    });

    expect(screen.getByLabelText('현재 입력한 기준 시점으로 답변받겠습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '질문 보내기' })).toBeDisabled();

    fireEvent.click(screen.getByLabelText('현재 입력한 기준 시점으로 답변받겠습니다'));
    expect(screen.getByRole('button', { name: '질문 보내기' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run the UI test to verify it fails**

Run: `npm run test -- tests/unit/app-shell.test.tsx`
Expected: FAIL because the UI components do not exist yet.

- [ ] **Step 3: Implement the desktop-first app shell and cards**

```tsx
// src/components/question-form.tsx
'use client';

export function QuestionForm(props: {
  value: string;
  effectiveDate: string;
  onChange: (value: string) => void;
  onEffectiveDateChange: (value: string) => void;
  onReferenceDateConfirmationChange?: (checked: boolean) => void;
  onSubmit: () => void;
  onUseExample?: (value: string) => void;
  onCancel?: () => void;
  isLoading: boolean;
  submittedQuerySnapshot?: string | null;
  progressStageLabel?: string | null;
  dateHintMessage?: string | null;
  referenceDateConfirmationRequired?: boolean;
  referenceDateConfirmed?: boolean;
  serviceUpdateSummary?: string | null;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">대한민국 법령 기반 실무 도구</p>
      <h2>무엇을 도와주나요?</h2>
      <p id="query-help">
        현장 상황을 문장으로 입력하면 기준 시점에 맞는 법령을 찾고, 필요한 경우에만 추가 질문한 뒤 근거 조문과 함께 결론을 제시합니다.
      </p>
      <ul className="helper-list">
        <li>예: 비계 설치 자격, 협력업체 교육 책임, 사고 당시 의무</li>
        <li>기준 시점은 적용 법령 버전을 결정합니다.</li>
        <li>이 앱은 1차 스크리닝 도구이며 최종 판단은 전문가 확인이 필요합니다.</li>
      </ul>
      {props.serviceUpdateSummary ? <p className="update-note">최근 업데이트: {props.serviceUpdateSummary}</p> : null}
      <div className="example-chips">
        <button type="button" onClick={() => props.onUseExample?.('비계 설치 높이 10m일 때 자격이 필요해?')}>
          비계 자격 요건
        </button>
        <button type="button" onClick={() => props.onUseExample?.('협력업체 근로자 안전교육 책임은 누구에게 있나?')}>
          협력업체 교육 책임
        </button>
        <button type="button" onClick={() => props.onUseExample?.('2024년 3월 사고 당시 이 조치 의무가 있었나?')}>
          사고 당시 의무
        </button>
      </div>
      <label htmlFor="query" className="section-title">
        질문하기
      </label>
      <textarea
        id="query"
        aria-label="법령 질문 입력"
        aria-describedby="query-help privacy-note"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="예: 비계 설치 높이가 10m일 때 자격 요건이 필요한가?"
        rows={6}
      />
      <label htmlFor="effectiveDate" className="section-title">
        기준 시점
      </label>
      <input
        id="effectiveDate"
        aria-label="기준 시점"
        aria-describedby={props.dateHintMessage ? 'effectiveDateHelp dateHint' : 'effectiveDateHelp'}
        type="date"
        value={props.effectiveDate}
        onChange={(event) => props.onEffectiveDateChange(event.target.value)}
      />
      <p id="effectiveDateHelp" className="field-help">
        과거 사고·점검·계약을 묻는다면 반드시 기준 시점을 확인하세요. 이 날짜가 답변에 쓰는 법령 버전을 결정합니다.
      </p>
      {props.dateHintMessage ? (
        <p id="dateHint" className="warning-banner" role="status" aria-live="polite">
          {props.dateHintMessage}
        </p>
      ) : null}
      {props.referenceDateConfirmationRequired ? (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={Boolean(props.referenceDateConfirmed)}
            onChange={(event) => props.onReferenceDateConfirmationChange?.(event.target.checked)}
          />
          현재 입력한 기준 시점으로 답변받겠습니다
        </label>
      ) : null}
      <button
        onClick={props.onSubmit}
        disabled={
          props.isLoading ||
          props.value.trim().length === 0 ||
          (props.referenceDateConfirmationRequired && !props.referenceDateConfirmed)
        }
      >
        {props.isLoading ? '검색 중...' : '질문 보내기'}
      </button>
      {props.isLoading && props.onCancel ? (
        <button type="button" onClick={props.onCancel}>
          현재 요청 취소
        </button>
      ) : null}
      {props.isLoading ? (
        <p className="pending-helper" aria-live="polite" role="status">
          {props.progressStageLabel ?? '질문을 처리하고 있습니다.'}
        </p>
      ) : null}
      {props.submittedQuerySnapshot ? (
        <p className="submitted-snapshot">현재 처리 중인 질문: {props.submittedQuerySnapshot}</p>
      ) : null}
      <p id="privacy-note" className="privacy-note">질문 기록은 로그인한 사용자 계정 기준으로만 저장됩니다.</p>
    </section>
  );
}
```

```tsx
// src/components/answer-card.tsx
export function AnswerCard(props: {
  strength: 'clear' | 'conditional' | 'verification_pending';
  effectiveDate: string;
  verifiedFacts?: string[];
  conclusion: string;
  explanation: string;
  caution: string;
  generatedFromSkip?: boolean;
  answeredScope?: string[];
  unansweredScope?: string[];
  priorityOrder?: string[];
  collapsedLawSummary?: string;
  lawSections?: Array<{
    lawTitle: string;
    summary: string;
    whyItApplies?: string;
    checkFirst?: string[];
  }>;
  expandedLawSectionCount?: 2 | 4;
  citations: Array<{
    lawTitle: string;
    articleNumber: string;
    quote: string;
    effectiveFrom?: string;
    verificationSource?: 'local' | 'mcp';
    changedSummary?: string | null;
  }>;
  changedSinceCreated?: boolean;
}) {
  const strengthLabel =
    props.strength === 'clear'
      ? '명확'
      : props.strength === 'verification_pending'
        ? '검증 지연'
        : '조건부 판단';
  const expandedLawSectionCount = props.expandedLawSectionCount ?? 4;
  const visibleLawSections = props.lawSections?.slice(0, expandedLawSectionCount) ?? [];
  const collapsedLawSections = props.lawSections?.slice(expandedLawSectionCount) ?? [];

  return (
    <section className="panel">
      {props.changedSinceCreated ? <p className="warning-banner">인용 조문이 변경되었습니다.</p> : null}
      {props.generatedFromSkip ? (
        <p className="warning-banner">빠진 사실을 가정해 생성된 임시 답변입니다.</p>
      ) : null}
      <p className="badge">{strengthLabel}</p>
      <p className="meta">기준 시점 {props.effectiveDate}</p>
      <p className="meta">출처: open.law.go.kr 원문, 한국 법령 MCP로 현행성 재검증</p>
      {props.lawSections && props.lawSections.length > 1 ? (
        <p className="meta">이 질문은 {props.lawSections.length}개 법령이 동시에 적용됩니다.</p>
      ) : null}
      <p className="helper-copy">이 답변은 직접 확인된 사실을 먼저 읽고, 그 다음에 판단과 주의사항을 읽도록 설계되어 있습니다.</p>
      {props.verifiedFacts?.length ? (
        <>
          <h3>직접 확인된 사실</h3>
          <ul>
            {props.verifiedFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </>
      ) : null}
      <h2>{props.conclusion}</h2>
      <p className="next-action">
        {props.strength === 'clear'
          ? '내부 공유 자료의 근거로 사용 가능합니다.'
          : props.strength === 'verification_pending'
            ? '최신 검증이 지연 중입니다. 재확인 후 공유하세요.'
            : '전제와 현장 사실이 일치하는지 확인 후 사용하세요.'}
      </p>
      {props.answeredScope?.length ? (
        <p className="scope-note">이번 답변이 다루는 범위: {props.answeredScope.join(', ')}</p>
      ) : null}
      {props.unansweredScope?.length ? (
        <p className="warning-banner">추가 확인이 필요한 범위: {props.unansweredScope.join(', ')}</p>
      ) : null}
      <p>{props.explanation}</p>
      {props.priorityOrder?.length ? <p>우선 판단 기준: {props.priorityOrder.join(' → ')}</p> : null}
      {visibleLawSections.length ? (
        <>
          <h3>복수 적용 법령</h3>
          <ul>
            {visibleLawSections.map((section) => (
              <li key={section.lawTitle}>
                <strong>{section.lawTitle}</strong>
                <p>{section.summary}</p>
                {section.whyItApplies ? <p>{section.whyItApplies}</p> : null}
                {section.checkFirst?.length ? (
                  <p>먼저 확인: {section.checkFirst.join(', ')}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {collapsedLawSections.length ? (
        <details>
          <summary>기타 관련 법령 {collapsedLawSections.length}건{props.collapsedLawSummary ? ` — ${props.collapsedLawSummary}` : ''}</summary>
          <ul>
            {collapsedLawSections.map((section) => (
              <li key={section.lawTitle}>
                <strong>{section.lawTitle}</strong>
                <p>{section.summary}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <h3>적용 근거</h3>
      <ul>
        {props.citations.map((citation) => (
          <li key={`${citation.lawTitle}-${citation.articleNumber}`}>
            <strong>
              {citation.lawTitle} {citation.articleNumber}
            </strong>
            <p className="citation-meta">
              시행 {citation.effectiveFrom ?? '확인 필요'} · {citation.verificationSource ?? 'local'}
            </p>
            <p>{citation.quote}</p>
            {citation.changedSummary ? <p>변경 요약: {citation.changedSummary}</p> : null}
          </li>
        ))}
      </ul>
      <h3>주의사항</h3>
      <p>{props.caution}</p>
      <p id="export-warning" className="meta">
        자동 익명화는 보조 기능입니다. 외부 공유 전 민감표현이 남지 않았는지 직접 확인하세요.
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={props.strength === 'verification_pending'}
          aria-disabled={props.strength === 'verification_pending'}
          aria-describedby="export-warning"
        >
          기본 내보내기: 민감표현 검토 후 익명화 PDF
        </button>
        <button
          type="button"
          disabled={props.strength === 'verification_pending'}
          aria-disabled={props.strength === 'verification_pending'}
          aria-describedby="export-warning"
        >
          원문 포함 PDF
        </button>
        <button
          type="button"
          disabled={props.strength === 'verification_pending'}
          aria-disabled={props.strength === 'verification_pending'}
        >
          복사
        </button>
        <button
          type="button"
          disabled={props.strength === 'verification_pending'}
          aria-disabled={props.strength === 'verification_pending'}
        >
          인쇄
        </button>
        <button type="button">전문가 검토 요청</button>
      </div>
      <p className="disclaimer">
        이 답변은 법률자문이 아니며, 최종 판단 전에 사내 법무 또는 변호사·공인노무사 확인을 권장합니다.
      </p>
    </section>
  );
}
```

```tsx
// src/components/clarification-card.tsx
export function ClarificationCard(props: { question: string; onSkip: () => void }) {
  return (
    <section className="panel warning-panel">
      <h2>추가 확인이 필요합니다</h2>
      <p>{props.question}</p>
      <button type="button" onClick={props.onSkip}>
        가정 포함 임시 답변 보기
      </button>
    </section>
  );
}
```

```tsx
// src/components/recovery-card.tsx
export function RecoveryCard(props: {
  kind:
    | 'auth_expired'
    | 'date_confirmation_required'
    | 'rate_limited'
    | 'queue_overloaded'
    | 'network_offline'
    | 'engine_timeout'
    | 'mcp_timeout'
    | 'verification_pending'
    | 'no_match';
  message: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
}) {
  return (
    <section className="panel warning-panel" role="alert" aria-live="assertive">
      <h2>
        {props.kind === 'auth_expired' ? '로그인이 만료되었습니다' : null}
        {props.kind === 'date_confirmation_required' ? '기준 시점 확인이 필요합니다' : null}
        {props.kind === 'rate_limited' ? '잠시 후 다시 시도해 주세요' : null}
        {props.kind === 'queue_overloaded' ? '현재 요청이 많아 바로 처리하지 못합니다' : null}
        {props.kind === 'network_offline' ? '네트워크 연결을 확인해 주세요' : null}
        {props.kind === 'engine_timeout' ? '생성이 지연되고 있습니다' : null}
        {props.kind === 'mcp_timeout' ? '최신 법령 검증이 지연되고 있습니다' : null}
        {props.kind === 'verification_pending' ? '최신 검증이 아직 완료되지 않았습니다' : null}
        {props.kind === 'no_match' ? '관련 법령을 바로 특정하지 못했습니다' : null}
      </h2>
      <p>{props.message}</p>
      <div className="actions">
        {props.primaryActionLabel ? (
          <button type="button" onClick={props.onPrimaryAction}>
            {props.primaryActionLabel}
          </button>
        ) : null}
        {props.secondaryActionLabel ? (
          <button type="button" onClick={props.onSecondaryAction}>
            {props.secondaryActionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
```

```tsx
// src/components/history-snapshot-panel.tsx
export function HistorySnapshotPanel(props: {
  snapshot: {
    user_query: string;
    query_effective_date: string;
    answer_behavior_version?: string;
    created_at?: string;
    conclusion: string | null;
    explanation: string | null;
    caution: string | null;
    changed_since_created: boolean;
    citations: Array<{ quote: string; changed_summary: string | null }>;
  };
}) {
  return (
    <section className="panel">
      <h2>저장된 답변 스냅샷</h2>
      <p>{props.snapshot.user_query}</p>
      <p>기준 시점 {props.snapshot.query_effective_date}</p>
      {props.snapshot.answer_behavior_version ? <p>답변 동작 버전 {props.snapshot.answer_behavior_version}</p> : null}
      {props.snapshot.created_at ? <p>생성 시각 {props.snapshot.created_at}</p> : null}
      {props.snapshot.changed_since_created ? (
        <p className="warning-banner">이후 법령 개정이 감지되었습니다.</p>
      ) : null}
      <p>{props.snapshot.conclusion}</p>
      <p>{props.snapshot.explanation}</p>
      <p>{props.snapshot.caution}</p>
      <ul>
        {props.snapshot.citations.map((citation, index) => (
          <li key={index}>
            <p>{citation.quote}</p>
            {citation.changed_summary ? <p>변경 요약: {citation.changed_summary}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx
// src/components/history-list.tsx
export function HistoryList(props: {
  items: Array<{
    id: string;
    user_query: string;
    status: 'clarify' | 'answered' | 'no_match' | 'schema_error' | 'engine_error' | 'canceled';
    answer_strength?: 'clear' | 'conditional' | 'verification_pending' | null;
    changed_since_created?: boolean;
    query_effective_date?: string;
    answer_behavior_version?: string;
    created_at?: string;
  }>;
  onOpenSnapshot?: (runId: string) => void;
  onRerunCurrentLaw?: (runId: string) => void;
}) {
  function strengthLabel(value: 'clear' | 'conditional' | 'verification_pending' | null | undefined) {
    if (value === 'clear') return '명확';
    if (value === 'conditional') return '조건부 판단';
    if (value === 'verification_pending') return '검증 지연';
    return null;
  }

  return (
    <aside className="panel sidebar">
      <h2>최근 질문</h2>
      <ul>
        {props.items.map((item) => (
          <li key={item.id}>
            <strong>{item.user_query}</strong>
            <span>
              {item.status === 'answered' ? '답변 완료' : null}
              {item.status === 'clarify' ? '추가 질문 대기' : null}
              {item.status === 'no_match' ? '법령 미탐지' : null}
              {item.status === 'schema_error' ? '생성 오류' : null}
              {item.status === 'engine_error' ? '엔진 오류' : null}
              {item.status === 'canceled' ? '요청 취소' : null}
              {item.status === 'answered' && item.answer_strength === 'verification_pending'
                ? ' · 검증 지연'
                : null}
            </span>
            <p>
              {strengthLabel(item.answer_strength) ? `강도: ${strengthLabel(item.answer_strength)}` : null}
              {item.query_effective_date ? ` · 기준 시점 ${item.query_effective_date}` : null}
              {item.answer_behavior_version ? ` · 버전 ${item.answer_behavior_version}` : null}
              {item.created_at ? ` · ${item.created_at} 생성` : null}
            </p>
            {item.changed_since_created ? <em>변경됨</em> : null}
            <button type="button" onClick={() => props.onOpenSnapshot?.(item.id)}>
              당시 답변 보기
            </button>
            {item.status === 'answered' ? (
              <button type="button" onClick={() => props.onRerunCurrentLaw?.(item.id)}>
                현재 법령으로 새 답변 생성
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

```tsx
// src/components/app-shell.tsx
'use client';

import { useEffect, useState } from 'react';
import { AnswerCard } from '@/src/components/answer-card';
import { ClarificationCard } from '@/src/components/clarification-card';
import { HistoryList } from '@/src/components/history-list';
import { HistorySnapshotPanel } from '@/src/components/history-snapshot-panel';
import { QuestionForm } from '@/src/components/question-form';
import { RecoveryCard } from '@/src/components/recovery-card';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function AppShell(props: {
  initialHistory: Array<{
    id: string;
    user_query: string;
    status: 'clarify' | 'answered' | 'no_match' | 'schema_error' | 'engine_error' | 'canceled';
    answer_strength?: 'clear' | 'conditional' | 'verification_pending' | null;
    changed_since_created?: boolean;
    query_effective_date?: string;
    answer_behavior_version?: string;
    created_at?: string;
  }>;
  serviceUpdateSummary?: string | null;
}) {
  type ProgressStage = 'queued' | 'retrieving' | 'verifying' | 'generating' | 'finalizing';
  const serviceUpdateSummary =
    props.serviceUpdateSummary ?? '2026-04-14 업데이트: 기준 시점 확인, 진행 단계 안내, 검증 지연 경고를 강화했습니다.';

  function progressLabel(stage: ProgressStage | null) {
    if (stage === 'queued') return '질문 접수됨';
    if (stage === 'retrieving') return '관련 법령 찾는 중';
    if (stage === 'verifying') return '인용 조문 검증 중';
    if (stage === 'generating') return '답변 정리 중';
    if (stage === 'finalizing') return '응답 마무리 중';
    return null;
  }

  function getDateHintMessage(queryText: string, selectedEffectiveDate: string) {
    const explicitDateMatch = queryText.match(/(20\d{2})[.\-/년]\s*(\d{1,2})(?:[.\-/월]\s*(\d{1,2}))?/);
    if (explicitDateMatch) {
      const [, year, month, day] = explicitDateMatch;
      const normalized =
        day != null
          ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
          : `${year}-${month.padStart(2, '0')}`;
      if (!selectedEffectiveDate.startsWith(normalized)) {
        return `질문에 ${year}년 ${month}월 시점이 보입니다. 기준 시점을 다시 확인하세요.`;
      }
    }

    if (/(지난달|사고 당시|계약 당시|점검 당시|개정 전|당시)/.test(queryText) && selectedEffectiveDate === todayIso()) {
      return '질문에 상대 시점 표현이 있습니다. today 기준 답으로 오해하지 않도록 기준 시점을 직접 확인하세요.';
    }

    return null;
  }

  const [query, setQuery] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(() => todayIso());
  const [isLoading, setIsLoading] = useState(false);
  const [progressStage, setProgressStage] = useState<ProgressStage | null>(null);
  const [submittedSnapshot, setSubmittedSnapshot] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [recovery, setRecovery] = useState<{
    kind:
      | 'auth_expired'
      | 'date_confirmation_required'
      | 'rate_limited'
      | 'queue_overloaded'
      | 'network_offline'
      | 'engine_timeout'
      | 'mcp_timeout'
      | 'verification_pending'
      | 'no_match';
    message: string;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [expandedLawSectionCount, setExpandedLawSectionCount] = useState<2 | 4>(4);
  const [referenceDateConfirmed, setReferenceDateConfirmed] = useState(false);
  const dateHintMessage = getDateHintMessage(query, effectiveDate);
  const referenceDateConfirmationRequired =
    Boolean(query.match(/(20\d{2})[.\-/년]\s*(\d{1,2})(?:[.\-/월]\s*(\d{1,2}))?/)) && Boolean(dateHintMessage)
      ? true
      : Boolean(/(지난달|사고 당시|계약 당시|점검 당시|개정 전|당시)/.test(query) && effectiveDate === todayIso());

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const apply = () => setExpandedLawSectionCount(mediaQuery.matches ? 2 : 4);
    apply();
    mediaQuery.addEventListener('change', apply);
    return () => mediaQuery.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setReferenceDateConfirmed(false);
  }, [query, effectiveDate]);

  async function submit(
    options:
      | { mode: 'ask'; skipClarification?: boolean }
      | { mode: 'rerun_current_law'; runId: string } = { mode: 'ask' },
  ) {
    if (options.mode === 'ask' && referenceDateConfirmationRequired && !referenceDateConfirmed) {
      setRecovery({
        kind: 'date_confirmation_required',
        message: '기준 시점을 수정하거나 현재 기준일로 답변받겠다는 확인을 먼저 완료해 주세요.',
      });
      return;
    }

    const controller = new AbortController();
    const nextRequestId = requestId ?? crypto.randomUUID();
    setIsLoading(true);
    setProgressStage('queued');
    setRequestId(nextRequestId);
    setSubmittedSnapshot(query);
    setAbortController(controller);
    setRecovery(null);

    try {
      const body =
        options.mode === 'rerun_current_law'
          ? { mode: 'rerun_current_law', runId: options.runId }
          : {
              mode: 'ask',
              query,
              effectiveDate,
              clientRequestId: nextRequestId,
              referenceDateConfirmed,
              skipClarification: options.skipClarification ?? false,
            };

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Real implementation: subscribe to request-stage events from the server
      // and call setProgressStage('retrieving' | 'verifying' | 'generating' | 'finalizing')
      // as those events arrive. Do not simulate numeric percentages on the client.
      const payload = await response.json();

      if (!response.ok) {
        setRecovery({
          kind:
            response.status === 401
              ? 'auth_expired'
              : response.status === 400 && payload?.type === 'date_confirmation_required'
                ? 'date_confirmation_required'
              : response.status === 429
                ? 'rate_limited'
                : response.status === 503
                  ? 'queue_overloaded'
                  : response.status === 504 && payload?.type === 'mcp_timeout'
                  ? 'mcp_timeout'
                  : 'engine_timeout',
          message: payload?.message ?? '요청 처리에 실패했습니다.',
        });
        return;
      }

      if (payload.type === 'no_match') {
        setRecovery({
          kind: 'no_match',
          message: payload.message,
        });
        return;
      }

      if (payload.query) {
        setQuery(payload.query);
      }
      if (payload.effectiveDate) {
        setEffectiveDate(payload.effectiveDate);
      }
      if (payload.type === 'answer' && payload.strength === 'verification_pending') {
        setRecovery({
          kind: 'verification_pending',
          message: '최신 법령 교차검증이 지연되었습니다. 근거는 확인하되 외부 공유 전 다시 확인해 주세요.',
        });
      }
      setResult(payload);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setRecovery({
          kind: 'engine_timeout',
          message: '현재 요청을 취소했습니다. 질문을 수정한 뒤 다시 제출할 수 있습니다.',
        });
        return;
      }
      setRecovery({
        kind: typeof navigator !== 'undefined' && navigator.onLine === false ? 'network_offline' : 'engine_timeout',
        message: error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      });
    } finally {
      setProgressStage(null);
      setAbortController(null);
      setRequestId(null);
      setIsLoading(false);
    }
  }

  function cancelInFlight() {
    abortController?.abort();
  }

  async function openSnapshot(runId: string) {
    const response = await fetch(`/api/history/${runId}`);
    const payload = await response.json();
    if (response.ok) {
      setSnapshot(payload.snapshot);
    } else {
      setRecovery({
        kind: response.status === 401 ? 'auth_expired' : 'engine_timeout',
        message: payload?.message ?? '저장된 답변을 불러오지 못했습니다.',
      });
    }
  }

  const recoveryPrimaryActionLabel =
    recovery?.kind === 'auth_expired'
      ? '다시 로그인'
      : recovery?.kind === 'rate_limited'
        ? '잠시 후 재시도'
        : recovery?.kind === 'date_confirmation_required'
          ? '기준 시점 다시 확인'
          : recovery?.kind === 'queue_overloaded'
            ? '잠시 후 재시도'
            : recovery?.kind === 'network_offline'
              ? '연결 확인 후 재시도'
              : recovery?.kind === 'no_match'
                ? '질문 표현 바꾸기'
                : '다시 시도';

  const recoverySecondaryActionLabel =
    recovery?.kind === 'no_match'
      ? '기준 시점 확인'
      : recovery?.kind === 'verification_pending'
        ? '임시답변으로 이해하고 계속 보기'
        : undefined;

  return (
    <main className="app-grid">
      <div className="content-column">
        <QuestionForm
          value={query}
          effectiveDate={effectiveDate}
          onChange={setQuery}
          onEffectiveDateChange={setEffectiveDate}
          onUseExample={setQuery}
          onReferenceDateConfirmationChange={setReferenceDateConfirmed}
          onCancel={cancelInFlight}
          onSubmit={() => submit({ mode: 'ask', skipClarification: false })}
          isLoading={isLoading}
          submittedQuerySnapshot={submittedSnapshot}
          progressStageLabel={progressLabel(progressStage)}
          dateHintMessage={dateHintMessage}
          referenceDateConfirmationRequired={referenceDateConfirmationRequired}
          referenceDateConfirmed={referenceDateConfirmed}
          serviceUpdateSummary={serviceUpdateSummary}
        />
        {isLoading ? (
          <section className="panel skeleton-panel" aria-live="polite" aria-busy="true">
            <p className="badge">진행 중</p>
            <h2>{progressLabel(progressStage) ?? '질문을 처리하고 있습니다.'}</h2>
            <ol className="progress-steps" aria-label="진행 단계">
              <li data-state={progressStage === 'queued' ? 'current' : 'done'} aria-current={progressStage === 'queued' ? 'step' : undefined}>질문 접수됨</li>
              <li data-state={progressStage === 'retrieving' ? 'current' : 'pending'} aria-current={progressStage === 'retrieving' ? 'step' : undefined}>관련 법령 찾는 중</li>
              <li data-state={progressStage === 'verifying' ? 'current' : 'pending'} aria-current={progressStage === 'verifying' ? 'step' : undefined}>인용 조문 검증 중</li>
              <li data-state={progressStage === 'generating' || progressStage === 'finalizing' ? 'current' : 'pending'} aria-current={progressStage === 'generating' || progressStage === 'finalizing' ? 'step' : undefined}>
                답변 정리 중
              </li>
            </ol>
            <div className="skeleton-block" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <p className="meta">퍼센트 대신 실제 확인 가능한 단계만 표시합니다.</p>
            <p className="meta">2~3초 이상 지연되면 계속 처리 중임을 명확히 알려줘야 합니다.</p>
          </section>
        ) : null}
        {!result && !props.initialHistory.length ? (
          <section className="panel">
            <h2>이 앱을 이렇게 사용하세요</h2>
            <ol>
              <li>현장 상황을 문장으로 입력합니다.</li>
              <li>기준 시점을 확인합니다.</li>
              <li>답변 강도와 직접 확인된 사실을 먼저 읽습니다.</li>
            </ol>
            <p className="update-note">최근 업데이트: {serviceUpdateSummary}</p>
            <p>결과가 없다고 해서 의무가 없다는 뜻은 아닙니다.</p>
          </section>
        ) : null}
        {recovery ? (
          <RecoveryCard
            kind={recovery.kind}
            message={recovery.message}
            primaryActionLabel={recoveryPrimaryActionLabel}
            secondaryActionLabel={recoverySecondaryActionLabel}
            onPrimaryAction={
              recovery.kind === 'auth_expired'
                ? () => window.location.reload()
                : recovery.kind === 'date_confirmation_required'
                  ? () => setRecovery(null)
                : recovery.kind === 'no_match'
                  ? () => setRecovery(null)
                  : () => submit({ mode: 'ask', skipClarification: false })
            }
            onSecondaryAction={
              recovery.kind === 'no_match' || recovery.kind === 'verification_pending'
                ? () => setRecovery(null)
                : undefined
            }
          />
        ) : null}
        {result?.type === 'clarify' ? (
          <ClarificationCard
            question={result.question}
            onSkip={() => submit({ mode: 'ask', skipClarification: true })}
          />
        ) : null}
        {result?.type === 'answer' ? (
          <AnswerCard
            strength={result.strength}
            effectiveDate={effectiveDate}
            verifiedFacts={result.verifiedFacts}
            conclusion={result.conclusion}
            explanation={result.explanation}
            caution={result.caution}
            generatedFromSkip={Boolean(result.generatedFromSkip)}
            answeredScope={result.answeredScope}
            unansweredScope={result.unansweredScope}
            priorityOrder={result.priorityOrder}
            collapsedLawSummary={result.collapsedLawSummary}
            lawSections={result.lawSections}
            expandedLawSectionCount={expandedLawSectionCount}
            citations={result.citations}
            changedSinceCreated={result.changedSinceCreated}
          />
        ) : null}
        {result?.type === 'schema_error' ? <p className="error-banner">{result.message}</p> : null}
        {result?.type === 'engine_error' ? <p className="error-banner">{result.message}</p> : null}
        {snapshot ? <HistorySnapshotPanel snapshot={snapshot} /> : null}
      </div>
      <HistoryList
        items={props.initialHistory}
        onOpenSnapshot={openSnapshot}
        onRerunCurrentLaw={(runId) => submit({ mode: 'rerun_current_law', runId })}
      />
    </main>
  );
}
```

When wiring the real UI, `현재 법령으로 다시 답변` must ignore the form's current `effectiveDate` and use server `today` so the action truly means "current law rerun."
The same UI should keep **2 expanded law blocks on mobile / 4 on desktop** as a layout contract, even if the answer payload contains more `lawSections`.

```ts
// src/lib/service-updates.ts
import { db } from '@/src/lib/db';

export async function getLatestServiceUpdate() {
  const [row] = await db<{
    behavior_version: string;
    summary: string;
    published_at: string;
  }[]>`
    SELECT behavior_version, summary, published_at
    FROM service_updates
    WHERE affects_answer_behavior = true
    ORDER BY published_at DESC
    LIMIT 1
  `;

  return row ?? null;
}
```

```tsx
// app/page.tsx
import { AppShell } from '@/src/components/app-shell';
import { listRecentRuns } from '@/src/lib/history';
import { requireCurrentUser } from '@/src/lib/auth/session';
import { getLatestServiceUpdate } from '@/src/lib/service-updates';

export default async function HomePage() {
  const user = await requireCurrentUser();
  const initialHistory = await listRecentRuns(user.id, 12);
  const latestServiceUpdate = await getLatestServiceUpdate();
  return <AppShell initialHistory={initialHistory} serviceUpdateSummary={latestServiceUpdate?.summary ?? null} />;
}
```

- [ ] **Step 4: Add the browser test and run the full UI verification**

```ts
// tests/e2e/ask-flow.spec.ts
import { test, expect } from '@playwright/test';

test('renders clarify and answer states from the ask API', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let callCount = 0;

  await page.route('**/api/ask', async (route) => {
    callCount += 1;

    if (callCount === 1) {
      await page.waitForTimeout(150);
      await route.fulfill({
        json: {
          type: 'clarify',
          question: '작업 높이를 알려주세요.',
        },
      });
      return;
    }

    await route.fulfill({
      json: {
        type: 'answer',
        strength: 'conditional',
        verifiedFacts: ['산업안전보건법 제140조는 위험 작업 자격 확보 의무를 둔다.'],
        conclusion: '현재 정보 기준으로는 자격 요건 검토가 필요합니다.',
        explanation: '근거 조문상 작업 높이와 작업 방식이 중요합니다.',
        caution: '정확한 수치와 작업 방식을 확인하세요.',
        citations: [
          {
            lawTitle: '산업안전보건법',
            articleNumber: '제140조',
            quote: '사업주는 위험 작업에 필요한 자격을 갖추게 해야 한다.',
          },
        ],
      },
    });
  });

  await page.goto('/');
  await expect(page.getByText('이 앱을 이렇게 사용하세요')).toBeVisible();
  await expect(page.getByText(/최근 업데이트:/)).toBeVisible();
  await page.getByLabel('법령 질문 입력').fill('사고 당시 이 조치 의무가 있었나?');
  await expect(page.getByLabel('현재 입력한 기준 시점으로 답변받겠습니다')).toBeVisible();
  await expect(page.getByRole('button', { name: '질문 보내기' })).toBeDisabled();
  await page.getByLabel('현재 입력한 기준 시점으로 답변받겠습니다').check();
  await expect(page.getByRole('button', { name: '질문 보내기' })).toBeEnabled();
  await page.getByLabel('법령 질문 입력').fill('');
  await page.getByLabel('기준 시점').fill('2026-04-14');
  await page.getByLabel('법령 질문 입력').fill('비계 설치 자격이 필요해?');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByText('진행 중')).toBeVisible();
  await expect(page.getByText('질문 접수됨')).toBeVisible();
  await expect(page.getByRole('button', { name: '현재 요청 취소' })).toBeVisible();
  await expect(page.getByText('작업 높이를 알려주세요.')).toBeVisible();
  await page.getByRole('button', { name: '가정 포함 임시 답변 보기' }).click();

  await page.getByLabel('법령 질문 입력').fill('비계 설치 높이 10m일 때 자격이 필요해?');
  await page.getByRole('button', { name: '질문 보내기' }).click();
  await expect(page.getByText('현재 정보 기준으로는 자격 요건 검토가 필요합니다.')).toBeVisible();
  await expect(page.getByText('직접 확인된 사실')).toBeVisible();
  await expect(page.getByText('산업안전보건법 제140조')).toBeVisible();
  await expect(page.getByRole('button', { name: '기본 내보내기: 민감표현 검토 후 익명화 PDF' })).toBeVisible();
  await expect(page.getByText('기준 시점 2026-04-14')).toBeVisible();
});
```

Run: `npm run test -- tests/unit/app-shell.test.tsx && npm run test:e2e -- tests/e2e/ask-flow.spec.ts && npm run build`
Expected: unit PASS, Playwright PASS, Next build PASS.

- [ ] **Step 5: Commit the UI and end-to-end coverage**

```bash
git add app/page.tsx src/components tests/unit/app-shell.test.tsx tests/e2e/ask-flow.spec.ts app/globals.css
git commit -m "feat: add desktop-first ask flow ui"
```

## Self-check before execution

- Spec coverage is complete for onboarding first-use guidance, service-update visibility, submitted-vs-draft handling, cancel/retry controls, authentication, user-isolated history, snapshot reopen, current-law rerun, reference-date-aware retrieval, conservative date hints, appendix indexing, alias-aware retrieval, runtime citation verification, source-backed answers, verified-facts-first rendering, partial-coverage disclosure, redaction-review export defaults, accessibility minimums, and desktop-first/mobile-floor UI.
- The plan also forces explicit reference-date confirmation on risky submits, preserves answer-behavior version for history traceability, and prevents the default export path from bypassing redaction review.
- There are no `TODO`, `TBD`, or “implement later” placeholders in this plan.
- Naming is consistent across later tasks: `runAssistantQuery`, `planAssistantAction`, `generateAnswer`, `verifyCitations`, `AppShell`, and `assistant_runs` are reused consistently.

## Suggested execution order

1. Task 1, Task 2, Task 3: establish app, database, and ingestion foundation.
2. Task 4, Task 5: make retrieval good enough before calling the model.
3. Task 6, Task 7: add the actual legal assistant behavior.
4. Task 8: ship the user-facing UI and browser-level verification.
