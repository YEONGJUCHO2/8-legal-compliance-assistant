# LIBRARIAN_PLAN — Query-Rewrite + Candidate Cap + 극한 Query 대응

## 배경
프로덕션 `/api/ask` 가 `포항제철소 전로 수리 현장에서 50cm 이상 비계 설치...` 같은 현장 자연어 질문에 대해 **no_match** 또는 **FUNCTION_INVOCATION_TIMEOUT (60s)** 을 반환함.

원인:
1. Retrieval 이 **공백 기반 lexical 토큰화**만 함. "포항제철소/전로/공구리" 같은 현장 용어는 법령 용어 ("작업발판/콘크리트 타설/추락방지") 와 매칭 안 됨.
2. 토큰이 너무 많으면 OR LIKE 로 거짓 양성 후보가 15개씩 잡혀, Codex prompt + MCP 검증 × 15 = 60s 초과.
3. 플랜 (`2026-04-11-…md` line 22, `plans/phase-05-engine-adapter.md`) 이 **"query rewrite" 레이어를 명시적으로 빠뜨림**. Codex 는 답변 생성만 담당.

사용자 기대: "AI 도서관 사서가 질문 해석 → 법령 용어로 변환 → 찾기 쉽게". 이번 턴에 이 **핵심 기능을 구현**. 하드코딩 금지 — LLM 이 의미 기반으로 매핑해야 함.

## 작업 지시

### A. Query Rewrite Hop (핵심 신규 기능)

#### A.1 스키마 추가
`src/lib/assistant/schemas/query-rewrite.schema.ts` 신규:
```ts
import { z } from "zod";

export const QueryRewriteSchema = z
  .object({
    legal_terms: z.array(z.string().min(1)).min(1).max(8),
    law_hints: z.array(z.string().min(1)).max(3),
    article_hints: z.array(z.string().min(1)).max(3),
    intent_summary: z.string().min(1).max(200)
  })
  .strict();
export type QueryRewriteOutput = z.infer<typeof QueryRewriteSchema>;
```
- `legal_terms`: 법령 조문에 **실제 쓰이는** 명사구 (예: "작업발판", "추락 방지 조치", "콘크리트 타설 계획"). 현장 용어/속어/지명/회사명/설비명은 제외.
- `law_hints`: 질문 맥락으로 추정되는 법령명 (없으면 빈 배열).
- `article_hints`: "제10조" / "별표 1" 형태 구체 인용이 있으면 추출.
- `intent_summary`: 질문의 진짜 요구 1문장 (조직 의사결정자에게 전달할 요약).

`src/lib/assistant/schemas/index.ts` 에 등록 + `engineOutputSchemas`/`engineOutputJsonSchemas` 에 `"query_rewrite"` 키 추가.

#### A.2 프롬프트
`src/lib/assistant/engine/prompt.ts` 에 `buildQueryRewritePrompt({ question, referenceDate }): EnginePrompt` 추가.

시스템 프롬프트 요구사항 (반드시 포함):
- "당신은 한국 산업안전보건 법령 검색을 돕는 사서입니다."
- "사용자의 자연어 질문에서 **법령 본문 검색에 쓸 수 있는 핵심 용어**만 추출하세요."
- "현장 속어·은어·지명·회사명·설비명·원문 그대로의 단어는 **법령 공식 용어로 치환**해서 추출하세요. 예: '공구리 치기' → '콘크리트 타설', '족장' → '비계', '안전띠' → '안전대', '곤돌라' → '달비계/달기구'."
- "아는 법령 용어가 없으면 관련성 높은 가장 일반적인 안전보건 용어를 제시하세요. 빈 배열 금지."
- "법령 외 산업(세법/환경법/건설업 일반 등) 으로 질문이 벗어나면 `intent_summary` 에 그 사실을 명시하고 `legal_terms` 는 최선의 산업안전 근사치로 채우세요."
- 출력은 `QueryRewriteSchema` 스키마만.

`referenceDate` 는 참고용으로 유저 프롬프트에 같이 첨부.

**유저 프롬프트 샘플**:
```
기준일: 2026-04-19
질문: 공구리를 치는데 필요한 안전조치를 알려줘
```

LLM 이 내는 이상적 출력:
```json
{
  "legal_terms": ["콘크리트 타설", "거푸집 작업", "작업발판", "추락 방지 조치"],
  "law_hints": ["산업안전보건기준에 관한 규칙"],
  "article_hints": [],
  "intent_summary": "현장 콘크리트 타설 작업 시 적용되는 안전보건 의무 확인"
}
```

#### A.3 엔진 호출 래퍼
`src/lib/assistant/query-rewrite.ts` 신규:
```ts
export async function rewriteQuery({
  engine,
  userId,
  question,
  referenceDate,
  logger
}): Promise<QueryRewriteOutput | null>;
```
- `engine.generate({ prompt: buildQueryRewritePrompt(...), schemaRef: "query_rewrite", schema: jsonSchema, userId })` 호출.
- 스키마 실패 시 1회 retry → 실패 시 `null` 반환 (no_match fallback 은 호출부가 처리).
- 타임아웃: 엔진 deadline 의 1/3 (default 10s), env `QUERY_REWRITE_DEADLINE_MS` 로 override 가능.
- 구조화 로그: `query_rewrite.success`, `query_rewrite.schema_error`, `query_rewrite.timeout`.

#### A.4 Run-query 오케스트레이션 연결
`src/lib/assistant/run-query.ts` 에서 retrieval 직전에 `rewriteQuery` 호출.

결합 규칙 (명시):
- 원본 토큰 + rewrite 의 `legal_terms` 를 합치되 **중복 제거 + rewrite 우선**.
- `law_hints` 는 기존 `normalizeQuery.lawHints` 에 append.
- `article_hints` 는 `articleNumberHints` 에 append.
- 토큰 총합 상한 8개 (너무 많으면 precision 떨어짐).
- rewrite 가 null 이면 기존 경로 그대로 (fallback).
- `rewrite` 결과 자체를 `logging.ts` 구조화 로그로 남기고, 가능하면 `assistant_runs` row 에 `query_rewrite_terms` JSON 컬럼 추가 (아래 B 참조).

#### A.5 DB 마이그레이션 007
`db/migrations/007_assistant_runs_query_rewrite.sql` 신규:
```sql
ALTER TABLE assistant_runs
  ADD COLUMN IF NOT EXISTS query_rewrite_terms JSONB,
  ADD COLUMN IF NOT EXISTS query_rewrite_intent TEXT;
```
- `history-store-pg.ts` / `history-store.ts` persist 에 두 필드 추가.
- `tests/unit/migrations.test.ts` + `tests/integration/migration.test.ts` 업데이트.

### B. Candidate Cap + 타임아웃 정합

1. `run-query.ts` 에서 retrieval 결과 **top 5 까지만** 엔진 prompt 에 포함 (기본). env `RETRIEVAL_CANDIDATE_CAP` (default 5) 로 조정.
2. MCP 검증도 **top 5 까지**. 현재 `verifyCitations` 가 parallel 로 돌면 괜찮지만 5개로 줄이면 확실.
3. 프로덕션 deadline 재조정:
   - `QUERY_REWRITE_DEADLINE_MS=10000` (신규 env)
   - `ENGINE_DEADLINE_MS=25000` (답변 생성, codex 21s + 여유)
   - `MCP_VERIFY_DEADLINE_MS=8000` (top 5, 5개 병렬 → 3초 예상)
   - `RETRIEVAL_DEADLINE_MS=3000`
   - `DEADLINE_SAFETY_MARGIN_MS=2000`
   - 합계: 48s ≤ 60s ✓
4. `src/lib/env.ts` schema 에 `QUERY_REWRITE_DEADLINE_MS` / `RETRIEVAL_CANDIDATE_CAP` 추가 + deadline budget superRefine 에 반영.
5. Vercel production env 에도 두 신규 var 주입 — 이 작업은 **Claude 가 수동 반영** (vercel env add). Codex 는 코드만.

### C. 테스트 (하드코딩 금지 확인)

#### C.1 Unit
`tests/unit/assistant/query-rewrite.test.ts` 신규:
- engine mock 이 structured output 반환 → `rewriteQuery` 가 정상 매핑
- schema_error 경로 → null 반환
- timeout → null 반환
- 원본 토큰과 rewrite 병합 규칙 (중복 제거, 우선순위, 상한 8개)

#### C.2 Integration — 극한 질문 6종 시나리오
`tests/integration/librarian-extreme-cases.test.ts` 신규:
실제 engine 은 deterministic stub 으로 주입하되 **고정 답변이 아닌 "질문에 따라 다른 답변" 을 반환** 해야 함. 즉 engine stub 이 입력 prompt 를 파싱해서 현장 용어 → 법령 용어 치환을 시뮬레이션:
- `stub 이 "공구리" 가 prompt 에 있으면 legal_terms=["콘크리트 타설","거푸집"]` 반환
- `"족장" 이 있으면 ["비계","작업발판"]`
- 등등 6개 현장 용어 매핑 테이블

**하드코딩이 아닌 이유**: 테스트용 engine stub 은 "LLM 이 이 매핑을 배운 것" 을 검증하기 위한 표식이지, production 런타임 하드코딩이 아님. Production Codex 가 실 LLM 능력으로 같은 매핑을 해내는지는 D 단계 실스모크에서 검증.

6종 현장 질문 시나리오:
1. `"공구리를 치는데 적절한 안전조치 사항을 알려줘"` — 콘크리트 타설
2. `"족장 위에서 작업할 때 뭐 해야 하나"` — 비계 작업
3. `"신나통 옮기는데 필요한 절차"` — 유해물질 취급
4. `"안전띠 매는 기준 뭐임?"` — 안전대·추락방지
5. `"곤도라 사용 전 체크리스트"` — 달비계·달기구 점검
6. `"전로 수리할 때 고소작업 안전"` — 고소작업 (2m 이상)

각 시나리오: `runQuery` 호출 → `assistant_runs.query_rewrite_terms` 에 예상 법령 용어가 들어있는지 + 응답 kind 가 `answer` 또는 `verification_pending` 인지 확인. no_match 는 허용 안 됨.

#### C.3 Regression 기존
`npm test` 전체 통과 유지 (현재 208 passed). query-rewrite 추가로 +~10 개 신규 테스트 예상.

### D. 실환경 스모크 (Codex 가 직접 수행)

**스모크 하드 가정 금지** — 실제 Codex daemon + MCP + Neon 을 다 연결해서 테스트:

1. `npm run build` + `vercel --prod` 재배포.
2. 아래 6개 극한 질문을 deployed `/api/ask` 에 실제 POST (사전에 `smoke-test-session-1776607373` 으로 seed 된 세션 쿠키 사용):
   - 위 C.2 의 6개 질문 + 추가 2개 **사용자 메시지 원문**:
     - `"공구리를 치는데 적절한 안전조치 사항을 알려줘"`
     - `"포항제철소 전로 수리 현장에서 비계 50cm 높이 이상의 비계를 설치하려면 전문 자격이 있어야 하는지?"`
3. 각 응답을 `RESULT.md` 에 기록:
   - 질문
   - kind (answer / clarify / verification_pending)
   - `conclusion` 첫 100자
   - 인용 조문 수 + 첫 조문의 (lawTitle, articleNo)
   - elapsedMs
4. **성공 기준**: 8개 중 **최소 6개** 가 `answer` 또는 `verification_pending` 으로 `conclusion` 포함. 나머지는 clarify (명확화 질문) 도 허용. `no_match` / timeout / schema_error 는 **재조정 대상** — 실패 질문에 대해 프롬프트 개선 or candidate cap 재조정 후 재실행.

### E. 최종 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 전체 통과 (새 테스트 포함)
- `npm run build` 성공
- Vercel 재배포 + 실스모크 8개 질문 중 최소 6개 success

## 금지
- 현장 용어 ↔ 법령 용어 매핑 **하드코딩 금지** (production 코드 경로에서). 테스트 stub 은 허용 (테스트 목적의 마킹일 뿐).
- LawStorage / Codex daemon 구현 교체 금지 — 호출만.
- `plan.md`, `INVARIANTS.md`, `CONTRACTS.md`, `plans/phase-*.md` 편집 금지. `SHIP_CHECKLIST.md` / `RESULT.md` / `README.md` / `DEPLOY.md` 는 허용.
- 새 npm 의존성 금지 (zod, pino 이미 있음).
- 긴 diff 출력 금지 — `RESULT.md` 40줄 이내 append.

## 완료 규약
1. `RESULT.md` 하단 append (40줄 이내):
   ```
   ## Librarian Query-Rewrite 구현
   - 상태: 성공|부분성공(사유)
   - 신규 파일: <목록>
   - 변경 파일: <목록>
   - 신규 마이그레이션: 007_assistant_runs_query_rewrite.sql
   - 실스모크 8 질문 결과:
     1. 공구리: kind=<>, conclusion="<30자>"
     ...
   - 검증: typecheck/lint/test/build 결과 (개수 포함)
   ```
2. 완료 시 왼쪽 Claude 페인(`surface:4`)에 정확히 `LIBRARIAN_IMPL_DONE` 만 송신.
3. 차단 시 `LIBRARIAN_IMPL_BLOCKED: <한줄 사유>`.
