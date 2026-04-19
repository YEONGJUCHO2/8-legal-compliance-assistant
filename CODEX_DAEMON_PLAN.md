# CODEX_DAEMON_PLAN — 로컬 Codex CLI 기반 엔진 데몬 실구현

## 배경
플랜 (`2026-04-11-legal-compliance-assistant.md` line 22, `plans/phase-05-engine-adapter.md`) 에 따르면 **MVP 엔진 경로는 Anthropic API 가 아니라 로컬 `codex` CLI (`codex mcp-server` 또는 `codex exec`) 를 감싼 Node.js 데몬**. Anthropic 은 ToS/장애 시 swap 스텁일 뿐. 현재 상태:

- `src/lib/assistant/engine/codex.ts` 는 **스텁** — `daemonUrl` 없으면 `ECONNREFUSED`, 있으면 `schema_error` 하드코딩 반환. 실제 generate 로직 없음.
- `scripts/codex-daemon.ts` / `scripts/codex-daemon.plist` — **미존재**.
- `.env.local`: `ENGINE_PROVIDER=codex_stub`, `CODEX_DAEMON_URL=http://127.0.0.1:4200`.
- 로컬 `codex` CLI 0.121.0 설치돼 있음 (로그인 상태). `codex exec --json --output-schema <file> "prompt"` 가 스키마 제약 JSON 출력을 지원. `--output-last-message <file>` 로 최종 assistant message 만 파일에 쓰기도 가능.

이번 턴에 **실제 데몬 + 실제 adapter** 를 구현해서 `/api/ask` 경로가 end-to-end 동작하도록 만든다.

## 작업 지시

### A. 데몬 구현
경로: `scripts/codex-daemon.ts` (신규)

요구사항:
1. **HTTP 서버** (`node:http`): 기본 바인딩 `127.0.0.1:4200`. `CODEX_DAEMON_PORT` / `CODEX_DAEMON_HOST` env로 override 가능.
2. **엔드포인트**:
   - `POST /generate`
     - 요청 body (JSON):
       ```ts
       {
         prompt: string;           // full user-role prompt (citation 포함, Phase 05 prompt builder가 이미 만든 것)
         schemaRef: "answer" | "clarify" | "no_match" | "verification_pending" | "schema_error";
         schema: object;           // JSON Schema (fenced by prompt builder)
         sessionId?: string;       // daemon이 관리하는 handle (prior 응답의 sessionId)
         timeoutMs?: number;       // 전체 타임아웃 (default 55000)
         model?: string;           // optional — "-m" 전달
       }
       ```
     - 응답 (JSON):
       ```ts
       {
         sessionId: string;            // 이번 호출의 새 session handle (codex rollout id)
         response: unknown;            // schema-valid JSON (parsed)
         schemaRetries: number;        // 0 | 1 (2 는 하단 schema_error)
       }
       ```
     - 에러 envelope:
       ```ts
       { error: { code: "schema_error" | "engine_timeout" | "engine_failure", message: string } }
       ```
   - `GET /health` → `200 {"ok": true, "codex_version": "<v>"}`.
3. **핵심 로직** (매 요청):
   - `schema` 를 임시 파일로 직렬화 (`mkdtemp` + `schema.json`). 요청 종료 후 cleanup.
   - `prompt` 도 임시 파일 또는 stdin 으로 전달 (JSON 이라 escape 안전 필요 — stdin 권장).
   - 명령: `codex exec --json --skip-git-repo-check --output-schema <schema-file> [--resume <prior-rollout-id>] --output-last-message <out-file> -` 로 spawn. stdin 으로 prompt 쓰기, 닫기.
   - `child_process.spawn` 으로 non-blocking. 타임아웃 hit 시 SIGTERM → 2s 후 SIGKILL.
   - stdout 을 line-by-line 읽어 JSON RPC 이벤트 파싱. `--json` 모드는 `{"type":"turn.completed", ...}` 같은 이벤트 스트림 형식. 실제 스트림 형태는 **1회 시험 호출 후 형식 확정** (`codex exec --json "..."` 샘플 수집).
   - 최종 assistant message (schema-valid JSON 이어야 함) 은 `--output-last-message` 파일에서 읽어 parse.
   - parse 실패 시 1회 재시도 (같은 prompt, 같은 schema, 새 session) → 재실패 시 `schema_error` envelope + `schemaRetries: 2`.
   - session 매핑: codex 이벤트에서 `"rollout_id"` 또는 `"session_id"` 추출 (실제 이름은 시험 호출로 확인). 없으면 UUIDv4 로 데몬이 관리하는 가상 handle 발급, 내부적으로 sessionId → rollout path 맵 유지 (메모리 + `~/.cache/legal-compliance-codex-daemon/sessions.json` 로 재시작 복원).
4. **동시성**: 단일 codex 프로세스가 한 번에 1건만 처리하도록 큐 (`p-queue` 같은 lib 없이 간단한 in-memory Promise chain). 초기 구현은 직렬 — 병렬화는 후속. 큐 길이 > 10 이면 `503 {"error":{"code":"engine_busy"}}`.
5. **그레이스풀 종료**: `SIGTERM` 받으면 진행 중 요청 완료 대기 후 exit.
6. **로깅**: `pino`. 요청 시작/종료, codex exit code, timeout, schema retries.
7. **실행 방법**:
   - 개발: `npm run daemon:codex` (package.json 에 추가).
   - 프로덕션: `scripts/codex-daemon.plist` (launchd) — 아래 B.

### B. launchd plist
경로: `scripts/codex-daemon.plist`

- `com.legalcompliance.codexdaemon` 라벨
- `ProgramArguments`: `npx tsx scripts/codex-daemon.ts`
- `WorkingDirectory`: 프로젝트 루트
- `EnvironmentVariables`: `PATH`, `CODEX_DAEMON_PORT`, `CODEX_HOME` 등 필요한 최소
- `StandardOutPath` / `StandardErrorPath`: `~/Library/Logs/legal-compliance-codex-daemon.{out,err}.log`
- `RunAtLoad=true`, `KeepAlive.SuccessfulExit=false` + `KeepAlive.Crashed=true` 로 크래시 재기동
- README 에 `launchctl load ~/Library/LaunchAgents/com.legalcompliance.codexdaemon.plist` 설치 가이드

### C. `src/lib/assistant/engine/codex.ts` 실구현
현재 스텁을 완전 교체. 새 adapter:

1. `generate(input)` 가:
   - `CODEX_DAEMON_URL` 필수. 없으면 `engine_config_missing` 에러.
   - POST /generate 호출 — body = `{prompt, schema, schemaRef, sessionId: priorHandleCodexSessionId, timeoutMs, model}`.
   - `fetch` with `AbortSignal.timeout(env.ENGINE_DEADLINE_MS)`.
   - 응답 파싱. 성공 시 `bindHandle({ ..., provider: "codex" })` 로 session store 갱신, 새 handle 반환.
   - 에러 응답 매핑:
     - `schema_error` → `{ type: "schema_error", ... }` + schemaRetries: 2
     - `engine_timeout`, `engine_busy`, `engine_failure` → throw adapter-specific error → orchestrator 가 recovery UI로.
2. 기존 `session-store.bindHandle` 로 `engine_sessions` row 생성/갱신 (Phase 05 cross-user-fuzz 안전 유지).

### D. 환경변수 + 검증
1. `.env.example` 의 `ENGINE_PROVIDER=codex_stub` → `ENGINE_PROVIDER=codex` 로 변경 (MVP 경로).
2. `src/lib/env.ts` 의 `providerSchema` 가 `codex` 를 허용하는지 확인 (현재 `"anthropic" | "codex_stub"` 일 가능성 — 있으면 `"codex"` 추가 or `"codex_stub"` → `"codex"` 정리).
3. `src/lib/assistant/deps.ts` production wiring: `ENGINE_PROVIDER=codex` 일 때 `createCodexAdapter({ daemonUrl: env.CODEX_DAEMON_URL })` 주입.
4. `SHIP_CHECKLIST.md` §1.2 (Anthropic API) → 대신 "Codex CLI + 데몬 기동" 으로 재작성. §2.4 (launchd plist 설치 가이드) 추가.

### E. 테스트
1. `tests/unit/engine/codex.test.ts` (기존 있음 — 확장): daemon HTTP 목킹으로 success / schema_error / timeout / engine_busy 경로 각각 검증.
2. `tests/integration/codex-daemon.test.ts` (신규): 데몬을 **실 프로세스로 spawn** (같은 repo내 `scripts/codex-daemon.ts`), `codex` CLI 는 **spawn 모킹** (PATH 조작으로 fake codex 바이너리를 /tmp 에 배치 — shell script 가 schema-valid JSON 을 `--output-last-message` 파일에 써주고 stdout 에 mock 이벤트 스트림 echo). 목적: daemon 이 제대로 child 관리/파일 cleanup/응답 포맷팅 하는지.
3. 기존 테스트 회귀 방지 — `npm test` 전체 통과 유지.

### F. 실환경 스모크 (Codex 가 이걸 직접 수행)
1. 데몬 기동: `npm run daemon:codex &`.
2. `curl -s http://127.0.0.1:4200/health` → 200 확인.
3. Next 서버 `npm run dev &` — 별도 포트 (기본 3000).
4. 실 질문 시나리오: 현재 로그인 없이는 `/api/ask` 가 401 이므로 직접 엔진 adapter 단위 스모크만 수행:
   ```ts
   // scripts/smoke-engine.ts (신규, 일회성)
   import { createCodexAdapter } from "@/lib/assistant/engine/codex";
   const adapter = createCodexAdapter({ daemonUrl: "http://127.0.0.1:4200" });
   const result = await adapter.generate({
     userId: "smoke-user",
     sessionId: undefined,
     prompt: "산안법 제10조의 안전조치 의무를 한 문장으로 알려주세요.",
     schemaRef: "answer",
     schema: <answer schema JSON>
   });
   console.log(JSON.stringify(result, null, 2));
   ```
   스크립트 실행 결과를 RESULT.md 에 복붙. 실제 응답 시간 측정.

### G. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 전체 통과
- `npm run build` 성공
- 실환경 스모크: adapter generate 성공, 응답 시간 기록

## 금지
- Anthropic API 관련 코드 추가 금지 (기존 `engine/anthropic.ts` 그대로 — ToS 장애 swap 스텁으로 유지).
- DB 마이그레이션 편집 금지.
- UI 편집 금지.
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md`, `CONTRACTS.md` 편집 금지. SHIP_CHECKLIST / RESULT / README 는 허용.
- 새 npm 의존성 금지 (pino 는 이미 있음).
- 긴 diff 출력 금지 — RESULT.md 40줄 이내 append.

## 완료 규약
1. `RESULT.md` 하단에 append (40줄 이내):
   ```
   ## Codex 로컬 데몬 실구현
   - 상태: 성공|부분성공
   - 신규 파일: <목록>
   - 변경 파일: <목록>
   - 데몬 포트/경로: <호스트:포트>
   - 실스모크 결과: <응답 JSON 요약 + 경과 ms>
   - 검증: typecheck/lint/test/build 결과
   ```
2. 완료 시 왼쪽 페인(`surface:4`)에 `CODEX_DAEMON_IMPL_DONE` 만 송신.
3. 차단 시 `CODEX_DAEMON_IMPL_BLOCKED: <한줄 사유>`.
