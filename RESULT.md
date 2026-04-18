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
