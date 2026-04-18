# TASK — History Snapshot Denormalization 갭 제거

## 맥락
history 스냅샷 복원 시 `mapPersistedCitation` (in-memory) / `mapCitationRow` (PG)가 다음 필드를 **하드코딩**한다:
- `law_id: null`
- `law_title: ""`
- `article_number: ""`
- `in_force_at_query_date: true`
- `answer_strength_downgrade` 필드 누락
- `rendered_from_verification: verification_source === "mcp"` (disagreement 고려 안 함)

이유: `QuestionHistoryCitationRow` (`src/lib/db/rows.ts:164`)에 해당 컬럼이 없고, `buildCitationPersistence` (`src/lib/verify/persist.ts`)도 이 값을 출력 안 함. DB `assistant_run_citations`에도 컬럼 없음.

이번 턴에 **저장 시 denormalize**해서 스냅샷이 당시 citation 상태를 그대로 복원하도록 고친다.

## 설계 결정
- **Denormalization** 방식 채택. 이유: snapshot 의미는 "당시 시점 동결" — 법령 변경 후에도 당시 렌더링을 재현해야 함. read-time hydration은 현재 값이 섞여 의미 왜곡.
- 실제 "변경 감지"는 기존 `stale_mark`/`changed_summary`로 처리되므로 중복 아님.

## 작업 지시

### A. 타입 확장
`src/lib/db/rows.ts::QuestionHistoryCitationRow`에 **필드 5개 추가**:
```ts
law_id: UUID | null;               // 기존 null 고정 → 실제 값 저장
law_title: string;                 // 기존 "" → 당시 law 제목
article_number: string;            // 기존 "" → 당시 article 번호
in_force_at_query_date: boolean;   // 기존 true → 당시 inForce
answer_strength_downgrade: "conditional" | "verification_pending" | null;
rendered_from_verification: boolean; // snake 컨벤션 유지, optional 아니라 명시 저장
```

### B. 마이그레이션 005
`db/migrations/005_history_citation_denormalization.sql` 신규:
```sql
ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS law_id UUID;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS law_title TEXT NOT NULL DEFAULT '';

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS article_number TEXT NOT NULL DEFAULT '';

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS in_force_at_query_date BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS answer_strength_downgrade TEXT;

ALTER TABLE assistant_run_citations
  ADD COLUMN IF NOT EXISTS rendered_from_verification BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assistant_run_citations
  DROP CONSTRAINT IF EXISTS assistant_run_citations_answer_strength_downgrade_check;

ALTER TABLE assistant_run_citations
  ADD CONSTRAINT assistant_run_citations_answer_strength_downgrade_check
  CHECK (answer_strength_downgrade IN ('conditional', 'verification_pending') OR answer_strength_downgrade IS NULL);
```

### C. `buildCitationPersistence` 출력 확장
`src/lib/verify/persist.ts`: `VerifiedCitation`에서 아래 값을 꺼내 `QuestionHistoryCitationRow`로 매핑:
- `law_id`: `citation.lawId`
- `law_title`: `citation.lawTitle`
- `article_number`: `citation.articleNo`
- `in_force_at_query_date`: `citation.inForce`
- `answer_strength_downgrade`: `citation.answerStrengthDowngrade ?? null`
- `rendered_from_verification`: `citation.rendered_from_verification`

기존 필드 의미·순서 유지. `PENDING_RUN_ID` 로직 그대로.

### D. In-memory store 반영
`src/lib/assistant/history-store.ts::mapPersistedCitation`:
- 하드코딩 전부 제거.
- 저장된 row에서 실제 값 반환.
- `answer_strength_downgrade` 필드도 Citation 응답에 포함 (undefined면 omit).
- `rendered_from_verification`도 저장값 사용.

### E. PG store 반영
`src/lib/assistant/history-store-pg.ts`:
- `CitationDbRow` 타입에 5개 컬럼 추가.
- `persistCitations`의 INSERT에 5개 컬럼 추가.
- `getSnapshot`의 SELECT에 5개 컬럼 추가.
- `mapCitationRow` 하드코딩 제거, DB 값 매핑.
- `answer_strength_downgrade`는 TEXT 컬럼에서 `"conditional" | "verification_pending" | null`로 캐스팅 (좁은 유니언).

### F. 테스트
- `tests/unit/verify/persist.test.ts` (있으면 확장, 없으면 신규): 새 5개 필드가 VerifiedCitation → QuestionHistoryCitationRow로 올바르게 매핑되는지 검증.
- `tests/unit/assistant/history-store.test.ts`: in-memory round-trip에서 5개 필드가 저장→복원 되는지 검증.
- `tests/unit/history-store-pg.test.ts`: PG store round-trip 검증 (모킹 기반).
- 기존 통합 테스트 `tests/integration/mcp-verification.test.ts`가 snapshot 경로를 건드리면 같이 업데이트.
- 기존 164 passed / 1 skipped 동등 이상 유지.

### G. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 통과
- `npm run build` 성공

## 금지
- 기존 마이그레이션 001~004 편집 금지. 신규는 005만.
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md` 편집 금지. 필요 시 `CONTRACTS.md`에 최소 보강만 허용.
- UI 로직 변경 금지.
- VerifiedCitation 인터페이스 변경 금지.
- 새 라우트·엔드포인트 추가 금지.

## 완료 규약
1. `RESULT.md` 섹션 append (20줄 이내):
   ```
   ## History Snapshot Denormalization 갭 제거
   - 상태: 성공|부분성공(사유)
   - 변경 파일: <목록>
   - 신규 마이그레이션: 005_history_citation_denormalization.sql
   - 타입 확장: QuestionHistoryCitationRow 5개 필드 추가 (law_id/law_title/article_number/in_force_at_query_date/answer_strength_downgrade/rendered_from_verification)
   - 검증: typecheck/lint/test/build 결과 + 신규 테스트 개수
   - 주의: DEFAULT '' NOT NULL 이므로 기존 row는 빈 문자열로 마이그레이션됨 (신규 persist부터 denormalized)
   ```
2. 완료 시 왼쪽 페인(`%2`)에 `SNAPSHOT_DENORM_DONE` 송신.
3. 장문/전체 diff 출력 금지. RESULT.md에 압축.
