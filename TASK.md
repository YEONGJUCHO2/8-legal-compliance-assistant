# TASK — rateLimit / history / idempotency PG 승격 (B안)

## 맥락
production deps에서 세 스토어가 여전히 in-memory:
- `createInMemoryRateLimitStore` (`src/lib/rate-limit.ts`)
- `createInMemoryHistoryStore` (`src/lib/assistant/history-store.ts`)
- `createInMemoryIdempotencyStore` (`src/lib/assistant/idempotency.ts`)

멀티 인스턴스/재기동 시 상태 유실 → 프로덕션 보증 불가. 이번 턴에 Postgres 구현으로 승격.

## 스키마 현황
- `001_base.sql`: `assistant_runs`, `feedback_events` 기존 존재. `rate_limit`/`idempotency` 관련 테이블 **없음**.
- 승격에 필요한 테이블이 누락되면 `db/migrations/004_runtime_state.sql`로 **신규 마이그레이션** 추가 (기존 001~003 편집 금지).

## 목표
1. 세 스토어의 Postgres 구현을 같은 인터페이스로 추가.
2. `src/lib/assistant/deps.ts::createProductionDeps`가 in-memory 대신 PG 구현 주입.
3. 필요한 테이블은 `004_runtime_state.sql`에 신설.
4. 각 스토어별 happy-path + 경합/만료 케이스 테스트 최소 1개씩 추가.
5. 기존 테스트 통과 유지 (현재 151 passed, 1 skipped).

## 작업 지시

### A. History Store (Pg)
- 인터페이스: `src/lib/assistant/history-store.ts::HistoryStore` 시그니처 유지.
- 대상 테이블: **기존 `assistant_runs` 재사용**. 필요한 칼럼 없으면 004에서 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`로 보강.
- 구현 파일: `src/lib/assistant/history-store-pg.ts` 신규.
- `createPgHistoryStore(db: Sql = getDb()): HistoryStore` 익스포트.
- 페이지네이션·정렬은 in-memory 구현과 동등 의미 유지.

### B. Rate Limit Store (Pg)
- 인터페이스: `src/lib/rate-limit.ts::RateLimitStore` 유지.
- 테이블 신설(004): `rate_limit_buckets`
  ```sql
  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    key TEXT PRIMARY KEY,
    tokens DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- 구현: token-bucket 의미 유지. 동시성을 위해 `SELECT ... FOR UPDATE` 또는 `INSERT ... ON CONFLICT DO UPDATE RETURNING` 중 하나로 원자성 보장. 택 1 후 근거 RESULT.md에 한 줄.
- 구현 파일: `src/lib/rate-limit-pg.ts`.
- `createPgRateLimitStore({ db, capacity, refillPerSec, now? })`.

### C. Idempotency Store (Pg)
- 인터페이스: `src/lib/assistant/idempotency.ts::IdempotencyStore` 유지.
- 테이블 신설(004): `idempotency_records`
  ```sql
  CREATE TABLE IF NOT EXISTS idempotency_records (
    key TEXT PRIMARY KEY,
    payload_hash TEXT NOT NULL,
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS ix_idempotency_records_expires_at
    ON idempotency_records (expires_at)
    WHERE expires_at IS NOT NULL;
  ```
- TTL 만료 체크는 lookup 시점에 `expires_at < now()`면 null 반환하고 백그라운드 청소는 스코프 밖 (정책 기록만 RESULT.md 한 줄).
- 구현 파일: `src/lib/assistant/idempotency-pg.ts`.
- `createPgIdempotencyStore({ db, now? })`.

### D. deps.ts 와이어
- `createProductionDeps`에서
  - `historyStore: createPgHistoryStore()`
  - `idempotencyStore: createPgIdempotencyStore()`
  - `rateLimitStore: createPgRateLimitStore({ capacity, refillPerSec })` — capacity/refill은 기존 env 또는 상수 재사용.
- fail-closed 가드 유지. dev 경로는 in-memory 그대로.

### E. 테스트
- `tests/unit/history-store-pg.test.ts`, `tests/unit/rate-limit-pg.test.ts`, `tests/unit/assistant/idempotency-pg.test.ts` 추가.
- postgres.js 모킹 또는 기존 통합 테스트 패턴 따라감. 각 파일 최소 2개: happy-path + edge(만료/초과/경합 1종).
- 004 마이그레이션 정합 테스트는 기존 `tests/integration/migration.test.ts` 패턴에 합류.

### F. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 통과 수 현재 ≥ 151 + 신규
- `npm run build` 성공

## 금지
- 기존 마이그레이션(001~003) 편집 금지.
- 인터페이스 시그니처 변경 금지.
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md` 수정 금지. 필요 시 `CONTRACTS.md`에 최소 보강만 허용.
- UI/route 로직 변경 금지.

## 완료 규약
1. `RESULT.md` 섹션 append (25줄 이내):
   ```
   ## Runtime State PG 승격 (history/rate-limit/idempotency)
   - 상태: 성공|부분성공(사유)
   - 신규 파일: <목록>
   - 신규 마이그레이션: 004_runtime_state.sql (변경 요약)
   - 선택한 동시성 전략 (rate-limit): <FOR UPDATE | ON CONFLICT DO UPDATE RETURNING> — 근거 한 줄
   - idempotency TTL 정책: lookup 시 만료 체크, 백그라운드 청소는 후속
   - 검증: typecheck/lint/test/build 결과 + 신규 테스트 개수
   - 후속: <있다면 한 줄씩>
   ```
2. 완료 시 **왼쪽 Claude 페인(%2)에 `RUNTIME_PG_DONE` 송신** (이전 턴에 신호 경로 확정됨).
3. 장문 출력·전체 diff 금지. RESULT.md에 압축.
