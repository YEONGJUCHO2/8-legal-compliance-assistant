# TASK — Citation 응답 네이밍 정리 (snake_case 통일)

## 맥락
직전 턴(MCP Integration Tests)에서 `Citation` 응답에 camelCase 필드가 신규 추가되면서 기존 snake_case 필드와 중복·혼용 상태가 됐다. 이번 턴에 contract 오염 전에 정리한다.

## 현황

기존 API 컨벤션: **snake_case** (`mcp_verified`, `in_force_at_query_date`, `verification_source`, `mcp_disagreement` 등).

직전 턴에 추가된 camelCase 필드 (source: `src/lib/db/rows.ts`, `src/lib/assistant/ask-schema.ts`, 응답 빌더 `src/lib/assistant/run-query.ts::buildCitationList`):

| camelCase 신규 | 기존 snake 대응 | 결정 |
|---|---|---|
| `disagreement` | `mcp_disagreement` (이미 존재) | **camel 삭제** — 기존 `mcp_disagreement` 사용 |
| `inForce` | `in_force_at_query_date` (이미 존재) | **camel 삭제** — 기존 `in_force_at_query_date` 사용 |
| `answerStrengthDowngrade` | 기존에 없음 | **snake로 리네임**: `answer_strength_downgrade` |

## 작업 지시

### A. 타입/스키마 정리
- `src/lib/db/rows.ts`의 `Citation` 인터페이스에서:
  - `disagreement?: boolean` **제거**
  - `inForce?: boolean` **제거**
  - `answerStrengthDowngrade?` **→ `answer_strength_downgrade?`** 로 이름 변경
- `src/lib/assistant/ask-schema.ts`의 `citationSchema`에서 동일 정리.
- `verification_source` enum은 `"local" | "mcp" | "missing"` 그대로 유지 (valid).
- `verification_pending` 응답의 top-level `status` 필드도 그대로 유지.

### B. 응답 빌더 정리
- `src/lib/assistant/run-query.ts::buildCitationList`에서:
  - `disagreement`, `inForce` 필드 출력 제거 (기존 `mcp_disagreement`, `in_force_at_query_date` 유지).
  - `answerStrengthDowngrade` → `answer_strength_downgrade` 필드명 변경.

### C. 테스트 업데이트
- `tests/integration/mcp-verification.test.ts`에서 위 필드 검증 시
  - `disagreement` 검증 → `mcp_disagreement`로 전환
  - `inForce` 검증 → `in_force_at_query_date`로 전환
  - `answerStrengthDowngrade` 검증 → `answer_strength_downgrade`로 전환
- 다른 테스트(`tests/unit/components/fixtures.ts`, `tests/unit/rows.test.ts`)도 동일 기준으로 정리.

### D. 기타 호출부
- repo 전체에서 `disagreement\s*[:=]`, `inForce\s*[:=]`, `answerStrengthDowngrade`를 grep해서 **Citation 응답 관련 호출부**만 동일하게 교체. (VerifiedCitation 내부 필드명 `answerStrengthDowngrade`는 내부 타입이므로 그대로 둬도 무방 — 응답 경계에서만 snake로 매핑되면 됨. 단 이중 진실을 피하고 싶다면 내부도 리네임 가능, 판단 맡김.)

## 검증
- `npm run typecheck` 0 에러
- `npm run lint` 0 에러
- `npm test` 통과 수 유지 (직전 151 passed, 1 skipped 동등 이상)
- `npm run build` 성공

## 금지
- 신규 필드/마이그레이션/route 추가 금지.
- `plan.md`, `INVARIANTS.md`, `plans/phase-*.md` 수정 금지.
- `mcp_disagreement`, `in_force_at_query_date`, `verification_source` 등 기존 필드 이름·의미 변경 금지.

## 완료 규약
1. `RESULT.md`에 섹션 append (15줄 이내):
   ```
   ## Citation 네이밍 정리
   - 상태: 성공
   - 변경 파일: <목록>
   - 삭제: disagreement, inForce (기존 snake 필드로 대체)
   - 리네임: answerStrengthDowngrade → answer_strength_downgrade
   - 검증: typecheck/lint/test/build 결과 + 테스트 통과 수
   ```
2. 완료 시 터미널에 `CITATION_RENAME_DONE` 출력.
