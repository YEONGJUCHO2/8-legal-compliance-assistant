# PHASE10_FIX_PLAN — /review 지적사항 F2/F4/F5/F6 수정

## 배경
`b8753e4` 까지 푸시된 Phase 10 regression 커밋에 대해 사후 `/review` 를 돌렸고, CRITICAL 1건(F1)은 이미 해결. 남은 INFORMATIONAL 4건을 한 커밋으로 마감한다.

## 작업 지시

### F2 — `tests/integration/regression/pg-09-10-identity-fuzz.test.ts` cross-user replay 실화
현재 test (line 65-108)는 tautology: userA의 세션 토큰으로 `getCurrentUser` 를 호출하고 당연히 userA 가 반환되면 "replay rejected" 라고 주장. 실제 replay 경로를 안 건드림.

**수정**: `InMemoryAuthStore` 의 내부 session map 을 어떻게 공격자가 tamper 할 수 있는지 (혹은 할 수 없는지) 실증. 구체적으로:
1. `createInMemoryAuthStore()` 의 내부 구조를 `src/lib/auth/in-memory-store.ts` 에서 확인. session 저장이 공개 API 로 노출되어 있지 않으면 `store.createSession` / `store.findSessionByTokenHash` (혹은 실제 메서드) 를 통해서만 접근 가능함을 테스트로 잠근다.
2. userA 가 발급받은 세션 토큰 hash 를 그대로 userB 명의의 별도 세션으로 재등록하는 시도를 한다 — 현재 공개 API 로는 `createSession({ userId: userB.id, tokenHash: <A의 hash> })` 로 동일 hash 를 두 user 에 bind 가능한지 검증.
   - 허용되면: **보안 결함이므로 RESULT.md GAP 에 기록** 하고, 현재 거동 고정 후 implementation 은 건드리지 말 것.
   - 거부되면: rejects.toMatchObject({ code: "session_conflict" }) 같은 구체적 에러 형태로 고정.
3. 토큰 hash 가 유니크하게 user 에 bound 된다면, `getCurrentUser` 가 userA 토큰으로 userB 를 반환할 수 있는 경로가 **구조적으로 존재하지 않음**을 assertion + 코멘트로 명시. 기존 동어반복 assertion 제거.
4. 변경 후 test 이름은 "characterizes session storage as bound to originating user; same token hash cannot be reused across users" 또는 유사하게 명확하게.

구현에 손대지 말 것 (스토어 수정 금지). 거동을 그대로 고정하고, 갭이 보이면 GAP 기록.

### F4 — `tests/integration/regression/malicious-corpus.test.ts` `as never` 제거
line 47 `}) as never;` — 타입 드리프트 은폐. 실제 `retrieveFn` 타입은 `AssistantDeps["retrieveFn"]` (또는 그 반환형 `RetrievalResult`).

**수정**:
1. `src/lib/search/retrieve.ts` / `src/lib/search/types.ts` 에서 `RetrievalResult` 의 실제 shape 확인.
2. override 객체를 `RetrievalResult` 타입으로 명시. 필요 시 `candidate` shape 을 `ArticleCandidate` 타입으로 맞추고, 누락/여분 필드를 정리.
3. 캐스팅이 정 필요하면 `as RetrievalResult` 까지 좁힐 것. `as never` / `as unknown as X` 금지.
4. 타입만 정리. 테스트 로직/assertion 은 유지.

### F5 — `tests/integration/regression/malicious-corpus.test.ts` echo-style engine
현재 `createStaticEngineAdapter()` (helpers.ts) 는 citation 입력을 무시하고 고정 응답 반환. "payload 부재 확인" 이 mock 이 mock한대로 반환하는지 확인하는 것밖에 안 됨.

**수정**:
1. `tests/integration/regression/helpers.ts` 에 `createEchoEngineAdapter(citations: { articleNo: string; body: string }[])` 추가 — `generate` 호출 시 prompt 로 넘어온 citation body 들을 **그대로** `conclusion` / `verifiedFacts` / `explanation` 에 포함시키는 adapter. 실제 `generate` 입력 shape 은 `src/lib/assistant/engine/types.ts` 의 `EngineAdapter.generate` 시그니처로 확인.
2. 주입된 citation body 가 schema-valid 한 response JSON 으로 감싸지게끔 (conclusion 에 citation text 를 literal 로 넣어도 answer schema 가 accept 하면 pass). schema validation 이 거르는 형태라면 test 는 그 거동을 assert 하는 방향으로 조정 — 어느 쪽이든 "injection payload 가 최종 answer 로 새지 않음" 을 증명해야 함.
3. malicious-corpus.test.ts 에서 기본 `createRegressionDeps` 대신 이 echo adapter 를 override 로 주입.
4. assertion 강화: 응답이 `answer` 라면 conclusion/verifiedFacts 에 payload 문자열이 포함되지 않음. `schema_error` 등 다른 kind 라면 그게 허용됨을 `REGRESSION_ALLOWED_KINDS` 로 확인하고 **payload 가 어디에도 새지 않는지**만 검증.

### F6 — `evals/retrieval/wedge-gold.json` 변호사 검증 플래그
q4-q8 조문 번호는 placeholder (변호사 미검증). 현재 schema 에는 검증 상태 표시 없음.

**수정**:
1. 각 item 에 `lawyerVerified: boolean` 필수 필드 추가. 현재 8 item 모두 `false` 로 시작 (q1-q3 포함 — 전체 미검증으로 정직하게).
2. `tests/unit/wedge-gold.test.ts` 의 zod schema 에 `lawyerVerified: z.boolean()` 추가.
3. 추가 test: "at least one item per category when lawyerVerified is true" — 현재는 0 개이므로 `test.todo` 또는 `expect(...).toBe(0)` 로 현재 상태 고정 + 주석 "Expand when lawyer review is done".
4. `minimum_required: 200` 은 유지.

### 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 전체 통과, 기존 186 passed 이상 유지 (테스트 개수 변동 허용)
- `npm run build` 성공

### 금지
- `src/lib/**` 구현 편집 금지.
- 새 의존성 금지.
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md`, `CONTRACTS.md` 편집 금지.
- 장문 diff 출력 금지 — `RESULT.md` 에 30줄 이내 append.

## 완료 규약
1. `RESULT.md` 하단에 append (30줄 이내):
   ```
   ## /review F2/F4/F5/F6 수정
   - 상태: 성공|부분성공
   - 변경 파일: <목록>
   - F2: <요약>
   - F4: <요약>
   - F5: <요약>
   - F6: <요약>
   - 발견 GAP: <있으면>
   - 검증: typecheck/lint/test/build 결과
   ```
2. 완료 시 왼쪽 Claude 페인(`surface:4`)에 정확히 `REVIEW_FIX_DONE` 만 송신.
3. 중간에 막히면 `REVIEW_FIX_BLOCKED: <한줄 사유>` 송신.
