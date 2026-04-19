# OPEN_LAW_ADAPT_PLAN — 한글 태그 응답 적응

## 배경
실제 `open.law.go.kr` API 응답은 한글 XML 태그를 쓴다. 현재 `src/lib/open-law/xml.ts` 는 영문 태그(`mst`, `title`, `lawId` 등)로 작성된 픽스처 기준으로 구현돼 있어서 실 API 응답을 파싱하면 빈 배열 반환. 결과적으로 `scripts/sync-laws.ts --all` 이 `targetsProcessed=6 documentsSynced=0` 으로 조용히 실패.

실제 검색 응답 샘플 (`https://www.law.go.kr/DRF/lawSearch.do?OC=jyj29617&query=산업안전보건법&target=law&type=XML`):
```xml
<LawSearch>
  <target>law</target>
  <키워드>산업안전보건법</키워드>
  <totalCnt>3</totalCnt>
  <resultCode>00</resultCode>
  <resultMsg>success</resultMsg>
  <law id="1">
    <법령일련번호>276853</법령일련번호>
    <현행연혁코드>현행</현행연혁코드>
    <법령명한글><![CDATA[산업안전보건법]]></법령명한글>
    <법령ID>001766</법령ID>
    <공포일자>20251001</공포일자>
    <시행일자>20251001</시행일자>
    <법령상세링크>/DRF/lawService.do?...&amp;MST=276853&amp;type=HTML&amp;efYd=20251001</법령상세링크>
  </law>
  ...
</LawSearch>
```

실제 상세 응답 (`lawService.do?target=law&MST=276853&type=XML`):
```xml
<법령 법령키="...">
  <기본정보>
    <법령ID>001766</법령ID>
    <공포일자>20251001</공포일자>
    <법령명_한글>산업안전보건법</법령명_한글>
    ...
  </기본정보>
  <조문>
    <조문단위 ...>
      <조문번호>10</조문번호>
      <조문제목>안전조치</조문제목>
      <조문내용>...</조문내용>
      ...
    </조문단위>
  </조문>
  <부칙>
    ...
  </부칙>
</법령>
```

(detail XML 전체 구조는 **실제 API 한번 호출해서 확인** 할 것 — 위는 프리픽스만 예시. `조문단위`에 `항/호`가 중첩될 수 있고, `별표` 는 별도 루트에 있을 수 있음.)

## 작업 지시

### A. 실제 응답 구조 캡처
1. 아래 curl 로 실제 응답 몇 개 저장해 분석:
```bash
mkdir -p /tmp/open-law-samples
curl -sS "https://www.law.go.kr/DRF/lawSearch.do?OC=jyj29617&query=%EC%82%B0%EC%97%85%EC%95%88%EC%A0%84%EB%B3%B4%EA%B1%B4%EB%B2%95&target=law&type=XML" > /tmp/open-law-samples/search.xml
curl -sS "https://www.law.go.kr/DRF/lawService.do?OC=jyj29617&target=law&MST=276853&type=XML" > /tmp/open-law-samples/detail.xml
```
2. `detail.xml` 전체 구조를 확인. 조문/항/호/별표/부칙 계층 정확히 파악.

### B. `src/lib/open-law/xml.ts` 재작성
1. `parseSearchResponse` 를 실제 XML 루트 `LawSearch` + `law` 자식 기준으로 재작성.
   - 필드 매핑:
     - `법령일련번호` → `mst`
     - `법령ID` → `lawId`
     - `법령명한글` → `title`
     - `공포일자` → `promulgationDate` (형식 `yyyymmdd` → `yyyy-mm-dd` 변환)
     - `시행일자` → `enforcementDate` (동일 변환)
   - CDATA 처리 (fast-xml-parser 가 자동 풀어줘야 함; 안 풀리면 `cdataTagName` 설정 조정).
2. `parseLawDetail` 를 실제 XML 루트 `법령` + `기본정보` + `조문` + `부칙` + `별표` 기준으로 재작성.
   - `기본정보` 로부터 law meta 생성:
     - `법령ID` / `법령명_한글` / `공포일자` / `시행일자` → `OpenLawLawDocument`
   - `조문.조문단위` 배열에서:
     - `조문번호` → `articleNo` ("제N조" 포맷으로 변환; 현재 코드가 기대하는 포맷 확인)
     - `조문제목` → `title`
     - `조문내용` → `body`
     - `항.항번호/항내용` → `paragraph` 엔트리
     - `항.호.호번호/호내용` → `item` 엔트리
     - `시행일자`, `폐지여부` 등 시간 필드가 있으면 반영
   - `부칙` 은 metadata 로 보관 (현재 스키마에 별도 저장 안 함 — 필요 시 추후 확장).
   - `별표` 는 `appendix` 배열로:
     - `별표번호` → `label`
     - `별표제목` → `title`
     - `별표내용` → `body`
3. 기존 `OpenLawArticle` / `ParsedLawDetail` / `SearchLawResult` / `OpenLawAppendix` / `OpenLawLawDocument` 타입 shape 은 유지. 매핑만 바뀌어야 downstream 변경 최소.

### C. 픽스처 교체
1. `tests/fixtures/open-law/san-an-search.xml`, `san-an-detail.xml`, `malicious-corpus.xml` 를 **실제 API 응답 축약본** 으로 교체. `/tmp/open-law-samples/search.xml` 에서 2~3개 law 만 남기고, `/tmp/open-law-samples/detail.xml` 에서 조문 3~5개, 별표 1~2개만 남긴 축약본 작성. CDATA 유지.
2. `malicious-corpus.xml` 은 injection payload 하나를 포함한 조문 1~2개로 재작성 (실제 포맷 + payload body).

### D. 기존 테스트 갱신
1. `tests/unit/open-law/xml.test.ts` 의 assertion 이 영문 필드 이름 기준이면 그대로 유지. 값(id, title 등)은 새 픽스처에서 실제로 읽히는 값으로 업데이트.
2. `tests/unit/open-law/sync.test.ts` 도 동일.
3. `tests/unit/open-law/sanitize.test.ts` 는 body 문자열 단위라 영향 없을 것 — 실행 후 실패시 최소 수정.
4. `tests/unit/open-law/normalize.test.ts`, `temporal.test.ts`, `mcp-client.test.ts` 영향 없을 것.

### E. Integration: 실 API 호출로 sync 재시도
1. 수정 완료 후 **실제 sync 실행**:
```bash
env -i PATH="$PATH" HOME="$HOME" SHELL="$SHELL" \
  DATABASE_URL="postgresql://postgres:postgres@localhost:5432/legal_compliance" \
  LAW_API_KEY="jyj29617" \
  KOREAN_LAW_MCP_URL="http://127.0.0.1:4100" \
  ENGINE_PROVIDER="codex_stub" \
  ANTHROPIC_API_KEY="stub" \
  CODEX_DAEMON_URL="http://127.0.0.1:4200" \
  APP_BASE_URL="http://localhost:3000" \
  AUTH_SECRET="dev-auth-secret-not-for-prod" \
  AUTH_MAGIC_LINK_TTL_MINUTES="15" \
  AUTH_FROM_EMAIL="legal-compliance@example.com" \
  METRICS_ACCESS_TOKEN="dev-metrics-token" \
  RETRIEVAL_DEADLINE_MS="30000" \
  ENGINE_DEADLINE_MS="12000" \
  MCP_VERIFY_DEADLINE_MS="15000" \
  ROUTE_MAX_DURATION_SECONDS="60" \
  DEADLINE_SAFETY_MARGIN_MS="2000" \
  npx tsx scripts/sync-laws.ts --all
```
2. 기대: `documentsSynced=6`, `createdArticles > 0`.
3. DB 검증:
```bash
docker exec legal-compliance-postgres psql -U postgres -d legal_compliance -c "SELECT title, COUNT(*) AS article_count FROM law_documents d LEFT JOIN law_articles a ON a.law_id = d.id GROUP BY title ORDER BY title;"
```
기대: MVP 6법령 전부 row 존재 + 조문 수 > 0.

### F. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 전체 통과, 기존 200 passed 이상
- `npm run build` 성공

## 금지
- Postgres migration 편집 금지.
- 새 npm 의존성 금지.
- `src/app/**` UI/route 편집 금지.
- 긴 diff 출력 금지 — `RESULT.md` 에 30줄 이내 append.

## 완료 규약
1. `RESULT.md` 하단에 append (30줄 이내):
   ```
   ## open.law.go.kr 실 API 적응
   - 상태: 성공|부분성공
   - 변경 파일: <목록>
   - 실 sync 결과: documentsSynced=N, createdArticles=M
   - DB 검증: SELECT 결과 law_documents 수 / law_articles 총 수
   - 검증: typecheck/lint/test/build 결과
   ```
2. 완료 시 왼쪽 페인(`surface:4`)에 정확히 `OPEN_LAW_DONE` 만 송신.
3. 차단 시 `OPEN_LAW_BLOCKED: <한줄 사유>` 송신.
