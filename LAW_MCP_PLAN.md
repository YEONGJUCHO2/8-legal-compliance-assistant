# LAW_MCP_PLAN — `korean-law-mcp` 서비스 실구현

## 배경
`src/lib/open-law/mcp-client.ts` 는 3개 GET 엔드포인트 가진 **REST 서비스**를 기대한다 (MCP stdio 프로토콜이 아니라 그냥 HTTP JSON). 현재 `KOREAN_LAW_MCP_URL=http://127.0.0.1:4100` 만 env 에 박혀 있고 서버 실체 없음. 통합 테스트 (`tests/integration/helpers/mock-mcp-server.ts`)는 내부 모킹 용.

플랜 근거:
- `2026-04-11-…md` line 17–19: "open.law.go.kr official open API" = 벌크/인덱싱, "korean-law-mcp server" = 런타임 검증 + 로컬 인덱스에 없는 법령 on-demand. 로컬 DB 비교 대상은 **live open.law.go.kr**.
- `plan.md` line 12: "Every answer is verified at render time against korean-law-mcp; disagreement favors the live verification path, not the local cache."

결론: MCP 서비스는 **open.law.go.kr REST 프록시 + 파싱 + 캐시**. `scripts/codex-daemon.ts` 와 같은 구조(Node HTTP + launchd).

## 작업 지시

### A. 서버 구현
경로: `scripts/law-mcp-server.ts` (신규, ~400줄 예상)

요구사항:
1. **HTTP 서버** (`node:http`): 기본 `127.0.0.1:4100`. `LAW_MCP_PORT` / `LAW_MCP_HOST` env로 override.
2. **공통 설정**:
   - `LAW_API_KEY` 필수 (open.law.go.kr OC 파라미터)
   - 타임아웃: 요청 전체 15s (`LAW_MCP_UPSTREAM_TIMEOUT_MS` override).
   - 로그: `pino`. 요청별 request-id, upstream path, cache hit/miss, 경과 ms.

3. **엔드포인트**:
   - `GET /health` → `200 {"ok": true, "upstream": "open.law.go.kr"}`.
   - `GET /laws/lookup?title=<한글 제목>`:
     - `src/lib/open-law/client.ts::searchLaws` 재사용 (`resolveAlias` 거쳐) → 첫 현행 매치 추출.
     - 응답: `{lawId, title}` — `lawId` 는 open.law.go.kr `법령ID`, `title` 은 `법령명한글` 표준형.
     - 미매치 → 404 `{error: "not_found"}`.
   - `GET /articles/lookup?lawId=<>&articleNo=<>&paragraph?=<>&item?=<>`:
     - `getLawDetail({ lawId, referenceDate: today })` 로 XML fetch, `parseLawDetail` 로 조문 배열 추출.
     - `articleNo` 매칭 ("제10조" / "제10조의2" 포맷; client 에서 넘겨주는 형식 그대로).
     - `paragraph` 지정되면 해당 항 선택, `item` 지정되면 해당 호 선택. 없으면 article 본문.
     - `snapshotHash` 는 open-law의 `sanitize.ts::computeSnapshotHash` 혹은 `body` SHA-256 hex 32 chars.
     - `latestArticleVersionId`: 간단히 `${lawId}:${articleNo}:${enforcementDate}` 형태의 stable ID (version row 개념은 이 서비스 내부에서 생성).
     - `changeSummary`: XML 에 `조문개정구분명` 같은 필드 있으면 그걸, 없으면 `null`.
     - 미매치 → 404.
   - `GET /articles/effective-range?lawId=<>&articleNo=<>&referenceDate=<YYYY-MM-DD>`:
     - 동일한 detail XML 에서 해당 조문의 `조문시행일자/조문종료일자/조문삭제일자` 또는 상위 법령의 `시행일자` 를 참고해 `{effectiveFrom, effectiveTo, repealedAt}` 반환.
     - 조문이 `referenceDate` 에 아직 시행 전이거나 이미 폐지됐으면 그 상태 그대로 반영 (nullable 필드로).

4. **캐시**: in-memory Map, TTL 10분. key: `law:${title}`, `article:${lawId}:${articleNo}:${paragraph||''}:${item||''}`, `effective:${lawId}:${articleNo}:${referenceDate}`. 간단 LRU (Map insertion order 로 관리, 상한 1000 entries).

5. **에러 매핑**:
   - upstream timeout → 504 `{error:"upstream_timeout"}`.
   - upstream 5xx → 502 `{error:"upstream_failure"}`.
   - zod validation 실패 (upstream 응답이 예상 shape 아닐 때) → 502 `{error:"upstream_schema_mismatch"}`.

6. **동시성**: 단순 Promise-based, 병렬 허용. upstream 연속 호출은 `p-limit` 같은 lib 없이 간단 세마포어 (기본 concurrency 5). 초과 시 큐 대기. 큐 길이 > 50 → 503.

7. **Graceful shutdown**: SIGTERM 받으면 진행 중 요청 완료 대기 후 exit.

### B. launchd plist
경로: `scripts/law-mcp-server.plist`

- `com.legalcompliance.lawmcpserver` 라벨
- `ProgramArguments`: `npx tsx scripts/law-mcp-server.ts`
- `WorkingDirectory`: 프로젝트 루트
- `EnvironmentVariables`: `LAW_API_KEY` (env 주입), `LAW_MCP_PORT`, `LAW_MCP_HOST`
- `StandardOutPath`/`StandardErrorPath`: `~/Library/Logs/legal-compliance-law-mcp.{out,err}.log`
- `RunAtLoad=true`, `KeepAlive.Crashed=true`

### C. package.json
`"daemon:law-mcp": "tsx scripts/law-mcp-server.ts"` 스크립트 추가.

### D. 테스트
1. `tests/integration/law-mcp-server.test.ts` (신규):
   - 서버를 실프로세스로 spawn (`scripts/law-mcp-server.ts`).
   - open.law.go.kr 호출을 막기 위해 `OPEN_LAW_FETCH_OVERRIDE_FILE` 같은 env 로 fake fetch 경로 주입 (또는 `--mock-fetch <file>` CLI 옵션).
   - 아래 케이스:
     - `/health` 200 OK
     - `/laws/lookup?title=산업안전보건법` → `{lawId:"001766", title:"산업안전보건법"}` (mock)
     - `/articles/lookup?lawId=001766&articleNo=제10조` → `{lawId, articleNo, body, snapshotHash, ...}`
     - `/articles/effective-range?lawId=001766&articleNo=제10조&referenceDate=2026-04-19` → `{effectiveFrom, effectiveTo, repealedAt}`
     - 404 경로 (존재하지 않는 title → 404)
     - 캐시 동작: 같은 요청 두 번 → upstream 호출 1회만
2. `tests/unit/open-law/mcp-server.test.ts` (신규, 선택): 내부 헬퍼 함수 단위 테스트.
3. 기존 `tests/integration/mcp-verification.test.ts` 에 이 실서버를 붙이는 것은 범위 밖 — 기존 mock-mcp-server 유지.

### E. 실환경 스모크
1. 데몬 기동:
   ```bash
   LAW_API_KEY=jyj29617 LAW_MCP_PORT=4100 npm run daemon:law-mcp &
   curl -s http://127.0.0.1:4100/health
   ```
2. 3개 엔드포인트 실호출:
   ```bash
   curl -s 'http://127.0.0.1:4100/laws/lookup?title=산업안전보건법' | jq
   curl -s 'http://127.0.0.1:4100/articles/lookup?lawId=001766&articleNo=제10조' | jq
   curl -s 'http://127.0.0.1:4100/articles/effective-range?lawId=001766&articleNo=제10조&referenceDate=2026-04-19' | jq
   ```
3. 각 응답 예시를 RESULT.md 에 10줄 이내 요약.

### F. 문서
1. `README.md` 에 "Korean Law MCP server" 섹션 추가 — `npm run daemon:law-mcp` + launchctl 가이드.
2. `SHIP_CHECKLIST.md` §1.4 (현재 "직접 운영 / 관리형") → 재작성: "로컬에선 `scripts/law-mcp-server.ts` 실행, 프로덕션에선 Fly.io 등으로 호스팅 (Dockerfile 추가는 후속)".
3. `DEPLOY.md` 에 MCP 서버 배포 관련 짧은 섹션 추가.

### G. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 전체 통과
- `npm run build` 성공
- 실스모크 3 엔드포인트 200 응답 + 구조 유효

## 금지
- open.law.go.kr 로직 재구현 금지 — 기존 `src/lib/open-law/{client,xml,normalize}.ts` 재사용.
- Postgres 접근 금지 (이 서비스는 stateless).
- 새 npm 의존성 금지.
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md`, `CONTRACTS.md` 편집 금지.
- 긴 diff 출력 금지 — RESULT.md 40줄 이내 append.

## 완료 규약
1. `RESULT.md` 하단에 append (40줄 이내):
   ```
   ## korean-law-mcp REST 서비스 실구현
   - 상태: 성공|부분성공
   - 신규 파일: <목록>
   - 변경 파일: <목록>
   - 데몬 포트/경로: 127.0.0.1:4100, npm run daemon:law-mcp
   - 실스모크: /health, /laws/lookup, /articles/lookup, /articles/effective-range 응답 요약
   - 캐시 히트 확인: 두번째 호출 upstream 미호출 증거
   - 검증: typecheck/lint/test/build 결과
   ```
2. 완료 시 왼쪽 페인(`surface:4`)에 `LAW_MCP_IMPL_DONE` 만 송신.
3. 차단 시 `LAW_MCP_IMPL_BLOCKED: <한줄 사유>`.
