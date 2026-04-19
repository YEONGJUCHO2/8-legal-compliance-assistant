# PHASE10_TODO_PLAN — Phase 10 남은 test.todo + gap 실 구현

## 배경
`5fe8b13` 시점 3 gap 이 documented todo 로 남음:
1. `pg-11-backpressure.test.ts` strict N/N concurrent-cap split
2. `uf-16-17-date-parser.test.ts` `어제`/`최근`/`요즘` 상대 phrase 감지
3. `pg-09-10-identity-fuzz.test.ts` 에서 characterize 된 동일 `tokenHash` 가 두 user 에 bind 되는 in-memory session store gap (PG 승격 시 위험)

이번 턴에 **셋 다 해결**. src/lib 수정 허용 (이전 플랜의 금지 해제 — 구조적 개선 단계).

## 작업 지시

### A. Rate limit 동시성 strict split 보장
**목표**: `createInMemoryRateLimitStore({ capacity: N, refillPerSec: 0 })` 에 2N 개 `checkRateLimit` 동시 요청 → **정확히 N 개 허용, N 개 거부**.

현재 `src/lib/rate-limit.ts` 의 InMemory 구현이 async read-modify-write 이라 race 가능 (동일 bucket 에 동시 2 요청 시 둘 다 capacity check 통과 가능성).

**수정**:
1. `src/lib/rate-limit.ts` `createInMemoryRateLimitStore` 내부에 **per-bucket Promise chain** 또는 **sync mutation 보장**:
   - 옵션 a) bucket 별 `Promise` lock: `this.lock = this.lock.then(() => syncOperation())` 패턴.
   - 옵션 b) 전체 연산을 sync 로 만들고 `async` wrapper 만 씌움 (현재 in-memory 는 이미 sync 여도 동작해야 함).
2. `checkRateLimit` / `consume` (정확한 메서드명 확인) 이 atomic 하게 read → decrement → return 하도록.
3. 기존 `tests/unit/rate-limit.test.ts` 에 영향 없는지 확인. 있으면 최소 수정.

**테스트**:
- `tests/integration/regression/pg-11-backpressure.test.ts` 의 `test.todo` 제거하고 실제 test 로 교체:
  - N=3, 2N=6 concurrent `runQuery`
  - 결과 분류: `allowedCount = response.kind !== "rate_limited"` 인 개수, `blockedCount = "rate_limited"` 인 개수
  - `expect(allowedCount).toBe(N)` / `expect(blockedCount).toBe(N)`
  - wall-clock 총 경과 < 2s (queue starvation 부재)
- `tests/unit/rate-limit.test.ts` 에 atomic concurrency unit test 추가 (직접 `store.consume` × 2N 병렬).

### B. Date-gate 상대 phrase 확장
**목표**: `detectSuspiciousDateHint` 가 `어제`, `최근`, `요즘` 을 flag.

**수정**:
1. `src/lib/assistant/date-gate.ts` 내부 상대 phrase 패턴 목록에 `어제`, `최근`, `요즘` 추가.
2. 반환 shape (`{ conflict: true, reason: "relative_past_hint", hint: <matched phrase> }`) 일관성 유지.
3. `tests/unit/assistant/date-gate.test.ts` 에 3개 phrase 단위 테스트 추가.
4. `tests/integration/regression/uf-16-17-date-parser.test.ts` 의 3개 `test.todo` → 실제 test 로 승격:
```ts
test.each(["어제", "최근", "요즘"])("flags %s as a relative phrase without auto-converting", (phrase) => {
  expect(detectSuspiciousDateHint(`${phrase} 기준 의무`, "2026-04-18", "2026-04-18")).toMatchObject({
    conflict: true,
    reason: "relative_past_hint",
    hint: phrase
  });
});
```
- `test.todo` 줄 제거.

### C. Session token hash uniqueness enforcement
**목표**: 동일 `tokenHash` 가 두 user 에 동시 bind 되는 것을 **저장소 레벨에서 거부**. 현재는 in-memory store 에서 허용되고 `findSessionByHash` 가 first-inserted 반환.

**수정**:
1. `src/lib/auth/in-memory-store.ts`:
   - `createSession` 에서 기존에 동일 `tokenHash` row 가 있으면 `AuthError({ code: "session_conflict" })` throw.
   - 동일 user 의 동일 hash 재등록 (멱등) 은 허용할지 여부 정책 결정: **거부** (새 세션이면 새 token hash 를 발급해야 함이 안전한 기본값). 동일 user 재등록도 error throw.
2. `src/lib/auth/pg-store.ts`:
   - `auth_sessions.token_hash` 에 UNIQUE 제약이 있는지 확인. 없으면 **migration 006 신설**: `ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_token_hash_unique UNIQUE (token_hash);`
   - PG `createSession` 이 unique violation 발생 시 `AuthError({ code: "session_conflict" })` 로 매핑.
3. `src/lib/auth/types.ts` 의 `AuthErrorCode` 에 `"session_conflict"` 추가.
4. 기존 `tests/unit/auth/pg-store.test.ts`, `tests/unit/auth/magic-link-consume.test.ts` 등에서 해당 경로가 깨지지 않는지 확인, 필요 시 수정.
5. `tests/integration/regression/pg-09-10-identity-fuzz.test.ts` cross-user replay 테스트 rewrite:
   - 현재 characterization ("first-inserted owner") 제거.
   - 새 assertion: 두 번째 `createSession` 이 `session_conflict` 로 throw.
   - `expect(store.findSessionByHash(tokenHash)?.userId).toBe(userA.id)` 유지.
6. migration 6 을 `tests/unit/migrations.test.ts` / `tests/integration/migration.test.ts` 에도 반영.

### D. RESULT.md append
```
## Phase 10 남은 todo 실 구현
- 상태: 성공
- 변경 파일: <src/lib 목록, tests 목록, migration 006>
- A (rate-limit atomic): <구현 요약 1줄>
- B (date-gate 상대 phrase): <구현 요약 1줄>
- C (session tokenHash uniqueness): <구현 요약 1줄 + migration 006>
- 제거된 test.todo: 4개 (pg-11 strict split, date-gate 어제/최근/요즘)
- 검증: typecheck/lint/test/build 결과
```

### E. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 전체 통과, 기존 187 passed 이상, 4 todo → 0 todo (또는 ≤2 todo)
- `npm run build` 성공

## 금지
- 새 npm 의존성 금지.
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md`, `CONTRACTS.md` 편집 금지.
- UI/라우트 로직 변경 금지.
- 긴 diff 출력 금지 — RESULT.md 30줄 이내.

## 완료 규약
- 완료 시 왼쪽 페인(`surface:4`)에 `TODO_DONE` 만 송신.
- 차단 시 `TODO_BLOCKED: <한줄 사유>`.
