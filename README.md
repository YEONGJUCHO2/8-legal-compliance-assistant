# Legal Compliance Assistant

한국 산업안전보건법 클러스터(산안법·중대재해처벌법·도급 관련 조항)에 대한 컴플라이언스 triage assistant. 질문 → triage packet(사실 / 인용 / 누락 정보 / 추천 담당자 / 에스컬레이션) 를 전문가가 바로 검토할 수 있는 형태로 반환. 인용은 `korean-law-mcp` 로 실시간 검증하며 근거가 없으면 답하지 않는다.

## Scope (MVP)

- **법령**: 산업안전보건법 · 시행령 · 시행규칙 · 산업안전보건기준에 관한 규칙 · 중대재해처벌법 · 동 시행령 · 부속 별표/별지
- **미포함**: 근로기준법 · 환경/화학/건설 안전법 · 세법 등 일반 한국법 전반. 포스트-MVP.

## Architecture

- Next.js 15 App Router (Node runtime pinned, 60s maxDuration)
- PostgreSQL 16 (관리형 권장, `pgcrypto` 필요; `pgvector` 미사용 — Phase 02b bake-off 결론: targeted cache + live MCP)
- Engine adapter: Anthropic Messages API (프로덕션), `codex_stub` (개발)
- 인용 검증: `korean-law-mcp` 런타임 호출, 불일치 시 `verification_pending` downgrade
- Auth: magic-link (pure-Node SMTP, `node:net`/`node:tls`)

전체 설계: [2026-04-11-legal-compliance-assistant-design.md](./2026-04-11-legal-compliance-assistant-design.md)
플랜: [plan.md](./plan.md) + [plans/](./plans/)
계약 / 불변식: [CONTRACTS.md](./CONTRACTS.md) · [INVARIANTS.md](./INVARIANTS.md)

## Development

### Prereqs

- Node 22+
- npm 11+
- (선택) 로컬 Postgres 16 + `pgcrypto` — 단위/통합 테스트는 in-memory store 로도 돌아감
- (선택) `korean-law-mcp` 로컬 인스턴스 — 없으면 mock MCP 로 통합 테스트

### Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local — placeholder 값은 test/dev 에서만 허용, production 은 fail-closed
```

### Run

```bash
npm run dev          # Next dev server on :3000
npm test             # vitest unit + integration (187 passed currently)
npm run test:e2e     # Playwright
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run build        # next build
npm run migrate      # scripts/migrate.ts (requires DATABASE_URL)
```

dev 모드는 NODE_ENV !== production 에서 fixture XML 을 in-memory LawStorage 로 시드하고 결정적 engine/MCP stub 을 주입한다 (`src/lib/assistant/dev-seed.ts`). production 에서는 실제 dependency 가 없으면 boot 거부.

## Project layout

```
src/
├── app/                  # Next App Router routes + pages
│   ├── api/              # 10 routes: ask, auth, export, feedback, history, metrics, ...
│   ├── history/[runId]/
│   ├── login/
│   └── page.tsx
├── components/           # UI (AppShell, AskForm, TriagePacket, etc.)
└── lib/
    ├── assistant/        # engine adapter, run-query orchestration, schemas, history store
    ├── auth/             # magic-link, sessions, pg-store, in-memory store, SMTP
    ├── db/               # postgres.js client + row types + storage
    ├── open-law/         # open.law.go.kr XML client + MCP client + normalize/sanitize
    ├── search/           # lexical + article-number + snapshot retrieval
    ├── verify/           # MCP-based citation verification engine
    ├── metrics/          # prom-compat registry + domain metrics
    ├── rate-limit.ts + rate-limit-pg.ts
    ├── logging.ts        # pino structured logs
    └── env.ts            # zod-validated env schema with deadline budget check

db/migrations/            # 001_base → 005_history_citation_denormalization (+ 002 vector opt-in)
evals/                    # wedge-gold.json + regression suites
tests/                    # unit + integration + e2e + fixtures
scripts/                  # migrate.ts, sync-laws.ts, resync-flagged.ts
```

## Key contracts

- **감소된 답변은 명시된다**: `verification_state ∈ { verified | verification_pending | degraded }`. free-text fallback 없음.
- **History immutability**: `assistant_runs` rows 는 append-only. 현행법 재실행(`answer-with-current-law`)은 **신규** row.
- **Snapshot denormalization**: citation 의 `law_title` / `article_number` / `in_force_at_query_date` / `answer_strength_downgrade` / `rendered_from_verification` 는 저장 시점의 값을 denormalize.
- **Deadline reconciliation**: `RETRIEVAL_DEADLINE_MS + ENGINE_DEADLINE_MS + MCP_VERIFY_DEADLINE_MS + DEADLINE_SAFETY_MARGIN_MS ≤ ROUTE_MAX_DURATION_SECONDS * 1000` — env schema 가 boot 시 검증.
- **보안 헤더**: `next.config.ts` 에 CSP / HSTS / X-Frame-Options / Referrer-Policy / Permissions-Policy.

## Deployment

[DEPLOY.md](./DEPLOY.md) — Vercel + managed Postgres 기준 runbook.

## Operations

[OPERATIONS.md](./OPERATIONS.md) — on-call 플레이북.

## Ship status

[SHIP_CHECKLIST.md](./SHIP_CHECKLIST.md) — 프로덕션 출시 전 해결해야 할 외부 의존 목록.

## License

TBD.
