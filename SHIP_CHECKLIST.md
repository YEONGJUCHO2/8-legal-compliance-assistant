# Ship Checklist — Production Go-Live

코드·설정·문서 단계는 본 브랜치에 전부 포함. 이 문서는 **사용자 결정·외부 계정·외부 크레덴셜**이 필요해서 autonomous 세션에서 못 닫은 항목만 정리. 여기에 있는 항목을 전부 해결하면 프로덕션 기동 가능.

범례: 🔴 반드시 필요 · 🟡 권장 · 🟢 선택

---

## 1. 외부 크레덴셜 (🔴 필수)

### 1.1 `open.law.go.kr` OpenAPI 키
- 신청: https://open.law.go.kr → 개발자 센터 → OpenAPI 신청
- 설정: Vercel env `LAW_API_KEY`
- 검증: `DATABASE_URL=<prod> LAW_API_KEY=<key> npx tsx scripts/sync-laws.ts` 실행, `law_documents` 테이블에 MVP 6법령이 올라왔는지 확인

### 1.2 Anthropic API 키
- 신청: https://console.anthropic.com → API Keys
- 설정: Vercel env `ANTHROPIC_API_KEY`, `ENGINE_PROVIDER=anthropic`
- 검증: deploy 후 임의 질문 1건 `/api/ask` → `kind: "answer"` 반환 확인

### 1.3 SMTP 크레덴셜
- 후보: SendGrid / Mailgun / AWS SES
- 설정: `SMTP_URL=smtps://user:pass@smtp.provider.com:465` (또는 587 STARTTLS)
- 별도: `AUTH_FROM_EMAIL=<verified-sender>` (SPF/DKIM 설정 완료된 도메인)
- 검증: 테스트 계정으로 `/api/auth/request` → 이메일 수신 → 링크 클릭 → 로그인 성공

### 1.4 `korean-law-mcp` 호스팅
- 옵션 A) 직접 운영: [korean-law-mcp](https://github.com/<org>/korean-law-mcp) 레포를 Fly.io / Cloud Run 등에 배포
- 옵션 B) 관리형 제공자 이용 (있다면)
- 설정: `KOREAN_LAW_MCP_URL=https://<host>`
- 검증: `curl <URL>/health` → 200; `/api/ask` 응답이 `verification_source: "mcp"` 포함

### 1.5 관리형 Postgres
- 후보: Supabase / Neon / AWS RDS
- 요구: Postgres 16+, `pgcrypto` extension, `sslmode=require`
- 설정: `DATABASE_URL=postgresql://user:pass@host:5432/legal_compliance?sslmode=require`
- 마이그레이션 실행: `DATABASE_URL=... npm run migrate` → 5~6개 파일 (001, 003, 004, 005, 006 [if added]) 반영 확인

---

## 2. 배포 플랫폼 (🔴 필수)

### 2.1 Vercel 프로젝트 생성
- `vercel link` → 이 repo 에 프로젝트 연결
- `.env.production.example` 의 모든 키를 Vercel Project Settings → Environment Variables (Production scope) 에 복사
- `AUTH_SECRET` 은 `openssl rand -base64 64` 생성
- `METRICS_ACCESS_TOKEN` 은 `openssl rand -hex 32` 생성
- Vercel Git Integration on — push to main 시 자동 배포

### 2.2 도메인
- Vercel Project → Domains → 커스텀 도메인 연결 (또는 `<slug>.vercel.app` 사용)
- `APP_BASE_URL` 을 실제 도메인으로 업데이트 (magic-link 생성에 사용)

### 2.3 첫 배포 smoke
- 배포 완료 후 `OPERATIONS.md` 의 "Health snapshot" 섹션 전체 실행, 5개 모두 기대값 일치 확인

### 2.4 GitHub Actions CI (🟡 권장)
Autonomous 세션에서 사용된 GitHub OAuth 토큰에 `workflow` scope 가 없어서 `.github/workflows/ci.yml` 을 push 할 수 없었음. 사용자가 `workflow` scope 가 포함된 Personal Access Token 으로 로컬 커밋·push 하거나, GitHub UI 에서 직접 파일을 추가해야 CI 가 켜짐.

**추가 경로**: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:
    name: typecheck + lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint

  unit:
    name: vitest
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/legal_compliance
      LAW_API_KEY: ci-placeholder
      KOREAN_LAW_MCP_URL: http://127.0.0.1:4100
      ENGINE_PROVIDER: codex_stub
      ANTHROPIC_API_KEY: ci-placeholder
      CODEX_DAEMON_URL: http://127.0.0.1:4200
      APP_BASE_URL: http://127.0.0.1:3000
      AUTH_SECRET: ci-placeholder-secret
      AUTH_MAGIC_LINK_TTL_MINUTES: "15"
      AUTH_FROM_EMAIL: ci@example.com
      METRICS_ACCESS_TOKEN: ci-metrics-token
      RETRIEVAL_DEADLINE_MS: "8000"
      ENGINE_DEADLINE_MS: "12000"
      MCP_VERIFY_DEADLINE_MS: "15000"
      ROUTE_MAX_DURATION_SECONDS: "60"
      DEADLINE_SAFETY_MARGIN_MS: "5000"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test -- --run

  build:
    name: next build
    runs-on: ubuntu-latest
    needs: [static, unit]
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/legal_compliance
      LAW_API_KEY: ci-placeholder
      KOREAN_LAW_MCP_URL: http://127.0.0.1:4100
      ENGINE_PROVIDER: codex_stub
      ANTHROPIC_API_KEY: ci-placeholder
      CODEX_DAEMON_URL: http://127.0.0.1:4200
      APP_BASE_URL: http://127.0.0.1:3000
      AUTH_SECRET: ci-placeholder-secret
      AUTH_MAGIC_LINK_TTL_MINUTES: "15"
      AUTH_FROM_EMAIL: ci@example.com
      METRICS_ACCESS_TOKEN: ci-metrics-token
      RETRIEVAL_DEADLINE_MS: "8000"
      ENGINE_DEADLINE_MS: "12000"
      MCP_VERIFY_DEADLINE_MS: "15000"
      ROUTE_MAX_DURATION_SECONDS: "60"
      DEADLINE_SAFETY_MARGIN_MS: "5000"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run build

  e2e:
    name: playwright
    runs-on: ubuntu-latest
    needs: [build]
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/legal_compliance
      LAW_API_KEY: ci-placeholder
      KOREAN_LAW_MCP_URL: http://127.0.0.1:4100
      ENGINE_PROVIDER: codex_stub
      ANTHROPIC_API_KEY: ci-placeholder
      CODEX_DAEMON_URL: http://127.0.0.1:4200
      APP_BASE_URL: http://127.0.0.1:3000
      AUTH_SECRET: ci-placeholder-secret
      AUTH_MAGIC_LINK_TTL_MINUTES: "15"
      AUTH_FROM_EMAIL: ci@example.com
      METRICS_ACCESS_TOKEN: ci-metrics-token
      RETRIEVAL_DEADLINE_MS: "8000"
      ENGINE_DEADLINE_MS: "12000"
      MCP_VERIFY_DEADLINE_MS: "15000"
      ROUTE_MAX_DURATION_SECONDS: "60"
      DEADLINE_SAFETY_MARGIN_MS: "5000"
      CI: "1"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7
```

---

## 3. 보안 / 법무 (🔴 필수)

### 3.1 프로덕션 시크릿 로테이션 정책
- `AUTH_SECRET`: 분기 1회, 유출 의심 시 즉시
- `METRICS_ACCESS_TOKEN`: 월 1회, 운영자 변동 시
- API keys: 벤더 정책 준수

### 3.2 변호사 검증 wedge gold set
- `evals/retrieval/wedge-gold.json` 은 현재 placeholder 8 item, 전부 `lawyerVerified: false`
- **정확도 게이트를 실제로 적용하려면 200+ lawyer-graded 문항 필요** (Phase 02b 결정의 전제)
- 외부 변호사 리뷰 발주 → JSON에 `lawyerVerified: true` 플래그 flip
- `tests/unit/wedge-gold.test.ts` 의 "currently keeps lawyer-reviewed coverage at zero" 테스트는 검증 진행됨에 따라 `toBeGreaterThan(...)` 으로 업데이트

### 3.3 프라이버시 / 데이터 보관 정책
- `assistant_runs` 은 append-only + 법적 책임 추적용 — 고객 질문·답변이 영구 보관됨. 삭제 요구 (GDPR 유사) 대응 프로세스 정의 필요
- 로그 보관 기간 (Vercel 로그 드레인 기본 30일) → 장기 보관 필요 여부 결정

### 3.4 이용약관 / 개인정보처리방침
- 법률 자문 제공 아님 (triage 목적)을 사용자에게 명시
- 현재 UI 에 disclaimer 노출 안 됨 → `src/components/shell/AppShell.tsx` 푸터에 추가 필요 (사용자 결정)

---

## 4. 모니터링 (🟡 권장)

### 4.1 메트릭 수집
- `/api/metrics` 엔드포인트가 Prometheus-compat 메트릭 노출 (token-gated)
- Prometheus / Grafana Cloud 등에서 주기적 scrape 설정
- Alert rule: `schema_retry_exhaustion_total` 급증, `mcp_disagreement_total` 급증, `per_stage_budget_burn_ms` P95 예산 초과

### 4.2 에러 추적
- Sentry / Datadog 등 외부 APM 추가 (현재 미연동) — `src/lib/logging.ts` 를 wrap

### 4.3 업타임 모니터링
- UptimeRobot / BetterUptime: `/login` (200) 및 `/` (307) 주기 점검

---

## 5. 백업·재해복구 (🟡 권장)

- 관리형 Postgres 의 PITR (point-in-time recovery) 활성화 확인
- 마이그레이션은 forward-only — 문제 발생 시 `NNN_revert_prior.sql` 작성 패턴 (DEPLOY.md 참조)
- Vercel deployment rollback: UI 에서 이전 배포 promote

---

## 6. Phase 02b 실측 (🟡 권장, 제품 품질 게이트)

`docs/architecture-bakeoff.md` 의 결정은 **provisional**. 실제 수치를 측정해야 함:

- Top-1 retrieval hit rate ≥ 70%
- Top-3 retrieval hit rate ≥ 90%
- wrong-law-in-top-3 < 5%
- p50 < 1500ms, p95 < 4000ms, cold-start < 500ms
- MCP 50% failure injection 시 graceful downgrade

수단: 200+ wedge gold (3.2 참조) 로 end-to-end 배치 실행 + 메트릭 스크래핑.

---

## 7. Phase 10 관찰성 확장 (🟢 선택, 수동 대응 가능)

현재 메트릭 emit 은 완비. 대시보드·알림은 외부 시스템이라 별도.

- Grafana dashboard JSON 작성 (리소스 확정 후)
- Alert manager rule 정의

---

## 8. 버전 0.2 이후 후속 과제 (🟢 선택, 이번 릴리스 불필요)

- 대규모 코퍼스 확장 (근로기준법, 환경/화학 안전법 등)
- `pgvector` 로컬 인덱스 옵션 재평가 (Phase 02b bake-off 재실행)
- Google OAuth, SSO 추가 (현재 magic-link 전용)
- 관리자 UI (service update publish, 사용자 관리)
- 모바일 앱 (React Native)

---

## 완료 기준

위 § 1~3 이 전부 해결되면 프로덕션 서비스 기동 가능. § 4~5 는 launch 와 동시에 병행. § 6~8 은 launch 이후.
