# 작업 결과

## 상태
부분 완료

## 변경 파일
- src/lib/assistant/deps.ts — production에서 스텁 런타임 fail-closed
- src/lib/auth/{email,magic-link}.ts — magic-link URL redaction + IP/UA abuse backstop
- src/app/api/{auth/request,metrics,export}/route.ts — 토큰 로그 제거, metrics token gate, export lock/confirmation enforcement
- src/components/{shell/AppShell,triage/TriagePacket,history/SnapshotView}.tsx — export 응답 사용, 하드코딩 date 제거, citation empty-state 처리
- .env.example — `METRICS_ACCESS_TOKEN` 예시 추가
- tests/unit/{assistant/deps,auth/magic-link-request,env}.test.ts — fail-closed/abuse-limit/env 회귀 테스트 추가
- tests/unit/components/triage-packet.test.tsx — no-citation 회귀 테스트 추가
- tests/integration/{api-metrics-route,api-secondary-routes,app-shell}.test.ts — metrics/export/app export 동작 검증 추가
- tests/e2e/boot.spec.ts — 로그인-first 부트 스모크로 정합성 수정

## 핵심 변경 내용
- 보안: magic-link bearer token이 로그에 남지 않도록 redaction 처리했고, 동일 IP/UA에서 다수 이메일로 요청하는 abuse 경로를 막았습니다. metrics는 내부 토큰 없이는 403으로 차단됩니다.
- 기능: export API가 verification_pending/미확인 redaction 검토를 우회하지 못하게 막았고, 클라이언트가 export 응답을 실제로 사용하도록 연결했습니다. citation이 없는 history/snapshot도 더 이상 크래시하지 않습니다.
- 운영 안정성: 기본 스텁 deps로 프로덕션이 조용히 뜨지 않도록 fail-closed로 바꿨습니다. 하드코딩된 `today="2026-04-18"`도 제거했습니다.

## 테스트/검증
- `npm run typecheck` 통과, `npm run lint` 통과, `npm test` => `56 passed, 1 skipped`
- `npm run build` 통과, `CI=1 npm run test:e2e` => `8 passed`
- `npm audit --omit=dev` => `found 0 vulnerabilities`

## 주의사항 / 후속 작업
- 현재 코드는 “실사용 가능” 판정이 아닙니다. `src/lib/assistant/deps.ts`는 production에서 fail-closed이며, PG/MCP/SMTP concrete wiring이 완료돼야 배포 가능합니다.
- `src/lib/auth/pg-store.ts`, `src/lib/db/storage.ts`, `src/lib/service-updates.ts`의 Postgres 구현과 관련 migration 정합성 점검이 다음 우선순위입니다.

## Dev Seed 추가
- 상태: 성공
- 변경 파일: `src/lib/assistant/dev-seed.ts`, `src/lib/assistant/deps.ts`, `tests/unit/assistant/deps.test.ts`
- 동작: `NODE_ENV !== production` 에서 Phase 03 XML fixture 기반 LawStorage seed, deterministic dev engine, 동일 body MCP stub을 주입하고 production fail-closed는 그대로 유지했습니다.
- 검증: `npm run typecheck`, `npm test` (`132 passed, 1 skipped`), `npm run build` 통과. 사용자 요청으로 실제 curl smoke는 이번 턴에서 생략했습니다.

## QA Fix: ZodError 400 응답 통일
- 상태: 성공
- 변경 파일: `src/lib/http/zod-bad-request.ts`, `src/app/api/{feedback,export,answer-with-current-law,auth/request}/route.ts`, `tests/integration/{api-secondary-routes,api-auth-request-route}.test.ts`
- 동작: `/api/feedback`, `/api/export`, `/api/answer-with-current-law`, `/api/auth/request` 가 잘못된 입력에 500 대신 400 `{ kind: "error" }` 을 반환하고, Zod issue만 warn 수준으로 기록합니다.
- 검증: `npm run typecheck`, `npm test` (`136 passed, 1 skipped`), `npm run build` 통과. 각 라우트 400 회귀 테스트와 유효 payload 200 경로를 함께 확인했습니다.

## Postgres Concrete Wiring
- 상태: 성공
- 변경 파일: `src/lib/auth/pg-store.ts`, `src/lib/db/storage.ts`, `src/lib/service-updates.ts`, `src/lib/assistant/deps.ts`
- 변경 파일: `db/migrations/003_postgres_concrete_wiring.sql`, `tests/unit/{auth/pg-store,db/storage,service-updates,assistant/deps.production,migrations}.test.ts`, `tests/integration/migration.test.ts`
- 신규 마이그레이션: `003_postgres_concrete_wiring.sql`
- 동작 요약: `pg-store`는 magic link/session/user identity 전 메서드를 postgres.js와 트랜잭션으로 구현했습니다.
- 동작 요약: `storage`는 `law_documents`/`law_article_versions` 조인으로 lexical·number·snapshot·hydrate 조회를 구현했습니다.
- 동작 요약: `service-updates`는 `listRecent`/`publish` upsert를 구현했고, production deps는 `DATABASE_URL` 존재 시 concrete store를 주입해 boot 가능하게 바꿨습니다.
- 검증: `npm run typecheck` 통과, `npm run lint` 통과, `npm test` => `145 passed, 1 skipped`, `npm run build` 통과, 신규 테스트 9개 추가
- 후속: `rateLimit`/`history`/`idempotency`는 여전히 in-memory입니다. 이번 범위에서는 production boot에 필요한 concrete wiring만 반영했습니다.

## MCP Verification Integration Tests (Phase 6 품질 잠금)
- 상태: 성공
- 변경 파일: `tests/integration/mcp-verification.test.ts`, `tests/integration/helpers/mock-mcp-server.ts`
- 변경 파일: `src/lib/{assistant/run-query,assistant/ask-schema,verify/engine,db/rows}.ts`, `tests/unit/{rows,components/fixtures}.test.ts`
- 신규 테스트: `tests/integration/mcp-verification.test.ts` + `helpers/mock-mcp-server.ts`
- 발견된 wiring gap / 수정 내역: agreement/out-of-force 응답이 `verification_source: "local"` 로 노출되던 문제, disagreement 시 `strength`가 `clear`로 남던 문제, `verification_pending` 응답에 top-level `status`가 없던 문제를 수정했습니다.
- 발견된 wiring gap / 수정 내역: citation 응답에 `disagreement`/`inForce`/`answerStrengthDowngrade`/`missing` source를 추가 노출했고, mock MCP 서버 close가 keep-alive로 지연되지 않도록 helper를 보강했습니다.
- 검증: `npm run typecheck` 통과, `npm run lint` 통과, `npm test` => `151 passed, 1 skipped`, `npm run build` 통과, 신규 통합 테스트 6개 추가

## Citation 네이밍 정리
- 상태: 성공
- 변경 파일: `src/lib/{db/rows,assistant/ask-schema,assistant/run-query}.ts`, `tests/integration/mcp-verification.test.ts`
- 삭제: `disagreement`, `inForce` (기존 snake 필드로 대체)
- 리네임: `answerStrengthDowngrade` → `answer_strength_downgrade`
- 검증: `npm run typecheck` 통과, `npm run lint` 통과, `npm test` => `151 passed, 1 skipped`, `npm run build` 통과

## Runtime State PG 승격 (history/rate-limit/idempotency)
- 상태: 성공
- 신규 파일: `src/lib/assistant/{history-store-pg.ts,idempotency-pg.ts}`, `src/lib/rate-limit-pg.ts`, `db/migrations/004_runtime_state.sql`, `tests/unit/history-store-pg.test.ts`, `tests/unit/rate-limit-pg.test.ts`, `tests/unit/assistant/idempotency-pg.test.ts`
- 수정 파일: `src/lib/{assistant/deps.ts,assistant/run-query.ts,rate-limit.ts}`, `tests/{unit/migrations.test.ts,integration/migration.test.ts,unit/rate-limit.test.ts}`
- 신규 마이그레이션: `004_runtime_state.sql` (`assistant_runs`/`assistant_run_citations` 보강, `rate_limit_buckets`/`idempotency_records` 신설)
- 선택한 동시성 전략 (rate-limit): `FOR UPDATE` — 기존 `checkRateLimit`의 read-modify-write를 같은 트랜잭션 row lock으로 묶어 lost update를 막았습니다.
- idempotency TTL 정책: lookup 시 만료 체크로 null 반환, `sweep()`는 만료 row opportunistic delete만 수행하고 백그라운드 청소는 후속
- 검증: `npm run lint` 통과, `npm test` => `159 passed, 1 skipped`, `npm run build` 통과, `npm run typecheck` 통과, 신규 단위 테스트 7개 + migration 검증 갱신
- 후속: `assistant_runs`의 legacy 컬럼(`payload_hash`, `verification_state` 등)은 기본값만 유지하고 새 PG history 경로에서는 읽지 않습니다.

## SMTP 실연동
- 상태: 성공
- 선택한 구현: 순수 SMTP — 새 의존성 없이 `node:net`/`node:tls`로 SMTP, STARTTLS, AUTH(PAIN/LOGIN) 경로를 직접 처리했습니다.
- TLS 정책: `smtps://` 및 `:465`는 즉시 TLS, `:587`은 STARTTLS 강제, `:25`는 plain SMTP로 처리합니다.
- 신규 파일: `src/lib/auth/email-smtp.ts`, `tests/unit/auth/email-smtp.test.ts`
- 수정 파일: `src/lib/{assistant/deps.ts,auth/email.ts,auth/types.ts}`, `src/app/api/auth/request/route.ts`, `tests/{integration/api-auth-request-route.test.ts,unit/assistant/deps.production.test.ts}`
- 와이어링: `deps.ts`에 `mailer`를 추가해 dev/test는 console, production은 `SMTP_URL`+`AUTH_FROM_EMAIL` 없으면 fail-closed 후 SMTP mailer를 주입했고 `/api/auth/request`가 이를 넘기도록 연결했습니다.
- 검증: `npm run lint` 통과, `npm test` => `164 passed, 1 skipped`, `npm run build` 통과, `npm run typecheck` 통과, 신규 테스트 5개 추가
- 주의: SMTP 경로에는 magicUrl 원문 로그를 추가하지 않았고, 기존 console preview만 redacted 출력을 유지합니다.

## History Snapshot Denormalization 갭 제거
- 상태: 성공
- 변경 파일: `src/lib/{db/rows.ts,verify/persist.ts,assistant/history-store.ts,assistant/history-store-pg.ts}`, `db/migrations/005_history_citation_denormalization.sql`, `tests/{unit/verify/persist.test.ts,unit/assistant/history-store.test.ts,unit/history-store-pg.test.ts,unit/migrations.test.ts,integration/migration.test.ts}`
- 신규 마이그레이션: `005_history_citation_denormalization.sql`
- 타입 확장: `QuestionHistoryCitationRow`에 `law_id`, `law_title`, `article_number`, `in_force_at_query_date`, `answer_strength_downgrade`, `rendered_from_verification` 저장 필드를 추가했습니다.
- 검증: `npm run lint` 통과, `npm test` => `166 passed, 1 skipped`, `npm run build` 통과, `npm run typecheck` 통과, 신규 테스트 2개 + 기존 테스트 4개 확장
- 주의: `DEFAULT '' NOT NULL` 컬럼(`law_title`, `article_number`) 때문에 기존 row는 빈 문자열로 마이그레이션되고, denormalized 값은 신규 persist부터 채워집니다.
