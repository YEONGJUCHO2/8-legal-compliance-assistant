# TASK — Postgres Concrete Wiring (Production Boot 가능화)

## 맥락
직전 RESULT.md 기준, 아래 3개 저장소가 `notImplemented()` / `TODO throw` 상태라 `NODE_ENV=production`에서 deps가 fail-closed로 막혀있음. 이번 턴에 실구현 채워서 production boot 가능하게 만든다.

대상 파일:
- `src/lib/auth/pg-store.ts` — 11개 AuthStore 메서드
- `src/lib/db/storage.ts` — 4개 LawStorage 메서드
- `src/lib/service-updates.ts` — PgServiceUpdateStore 2개 메서드 (`listRecent`, `publish`)

스키마: `db/migrations/001_base.sql` + `002_vector.sql` 기준. 타입: `src/lib/auth/types.ts`, `src/lib/search/storage.ts`, `service-updates.ts` 상단 인터페이스 — **시그니처 변경 금지**.

## 목표
1. 위 3파일의 모든 메서드를 postgres.js(`Sql`) 기반 구현으로 교체.
2. deps 런타임 (`src/lib/assistant/deps.ts`)이 `DATABASE_URL` 있으면 concrete store 주입하도록 확인. fail-closed는 연결 실패/누락 시에만 동작하게 유지.
3. 스키마 정합성 점검. 누락된 컬럼/테이블이 있으면 **`db/migrations/003_*.sql`로 분리 추가** (기존 001/002 편집 금지).
4. 각 대상 파일당 최소 1개 happy-path 테스트 추가 (회귀 방지).
5. 기존 테스트(136 passed, 1 skipped) 그대로 통과.

## 작업 지시

### A. PgAuthStore (`src/lib/auth/pg-store.ts`)
테이블: `auth_magic_links`, `auth_sessions`, `app_users`, `user_identities`.
- `createMagicLink`: INSERT, `redemption_attempts=0`, `state` 기본값은 in-memory-store와 동등.
- `findMagicLinkByHash`: `token_hash` 유니크 조회.
- `consumeMagicLink(id, consumedAt)`: `UPDATE ... SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL RETURNING *`. 이미 consumed면 null.
- `countMagicLinksForEmailSince(email, since)`: `WHERE email=$1 AND created_at >= $2` COUNT.
- `incrementRedemptionAttempts(id)`: +1 RETURNING. 컬럼이 스키마에 없으면 003에 추가.
- `createSession` / `findSessionByHash` / `revokeSession`: `auth_sessions` 기반.
- `findOrCreateUserByEmail`: identity upsert(트랜잭션). `user_identities(provider, provider_subject)` UNIQUE 활용.
- `findUserById`: `app_users` SELECT.

### B. DbLawStorage (`src/lib/db/storage.ts`)
대상: `law_articles`, `law_documents`.
- `findArticlesByLexical(query, opts)`: `pg_trgm` similarity + `unaccent`, ORDER BY similarity DESC LIMIT n. in-memory 랭킹 의미 유지.
- `findArticlesByNumber`: `law_id` + `article_no` 조합 조회.
- `findFromSnapshotCache`: `law_documents.snapshot_hash` 매칭.
- `hydrateArticles(ids[])`: `WHERE id = ANY($1::uuid[])` 배치, 입력 순서 보존.

### C. PgServiceUpdateStore (`src/lib/service-updates.ts`)
- 스키마에 `service_updates` 없으면 003 마이그레이션 추가:
  ```sql
  CREATE TABLE IF NOT EXISTS service_updates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    behavior_version TEXT NOT NULL,
    effective_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ix_service_updates_effective_date ON service_updates(effective_date DESC);
  ```
- `listRecent(limit)`: `ORDER BY effective_date DESC LIMIT $1`.
- `publish(update)`: INSERT ... ON CONFLICT (id) DO UPDATE (idempotent).

### D. deps 런타임 점검 (`src/lib/assistant/deps.ts`)
`DATABASE_URL` 존재 시 concrete store 주입 경로 확인. fail-closed 가드 유지하되 정상 boot 보장.

### E. 테스트
- 기존 `tests/integration/*` / `tests/unit/*` 패턴 따르기.
- 실DB 셋업이 없으면 `postgres` 라이브러리 모킹으로 SQL 호출 shape 검증하는 얇은 유닛 테스트라도 추가.
- 각 대상 파일당 happy-path 1개 이상.

### F. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 기존 + 신규 모두 통과
- `npm run build` 성공
- DATABASE_URL 없는 dev 경로 정상 동작 (dev-seed 유지)

## 금지
- `plan.md`, `CONTRACTS.md`, `INVARIANTS.md`, `plans/phase-*.md` 수정 금지.
- 기존 마이그레이션 파일(`001_*.sql`, `002_*.sql`) 편집 금지.
- 인터페이스/타입 시그니처 변경 금지.
- UI/라우트 로직 변경 금지 (스코프 밖).

## 완료 규약
1. `RESULT.md`에 섹션 **append** (30줄 이내):
   ```
   ## Postgres Concrete Wiring
   - 상태: 성공 | 부분성공(사유)
   - 변경 파일: <목록>
   - 신규 마이그레이션: 003_*.sql (있다면)
   - 동작 요약: pg-store / storage / service-updates 각 한 줄
   - 검증: typecheck/lint/test/build 결과 + 신규 테스트 개수
   - 후속: 남은 이슈/TODO
   ```
2. 완료 시 터미널에 `POSTGRES_WIRING_DONE` 한 줄 출력 (Claude가 꼬리 캡처로 확인).
3. 장문/전체 diff 출력 금지. 한 파일(RESULT.md)에 압축.
