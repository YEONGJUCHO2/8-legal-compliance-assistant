# TASK — SMTP 실연동 (magic-link 실메일 발송)

## 맥락
magic-link 발송은 현재 `createConsoleMailer`가 기본값이라 **콘솔에 URL만 찍고 실제 메일은 안 나감**. `MagicLinkMailer` 인터페이스는 `src/lib/auth/email.ts`에 이미 존재. 이번 턴에 SMTP 실구현 추가 + production deps 와이어 + env 처리.

## 현황
- 인터페이스: `MagicLinkMailer.send({ to, magicUrl, expiresAt }): Promise<void>` (`src/lib/auth/email.ts:1-7`)
- 기존 구현: `createConsoleMailer` 뿐
- env: `SMTP_URL?: string` (optional), `AUTH_FROM_EMAIL: string` (required)
- 사용처: `src/lib/auth/magic-link.ts::requestMagicLink`가 `mailer` 파라미터 받음 (default console)
- deps.ts는 **현재 mailer를 주입 안 함** — API 라우트에서 `/api/auth/request` 경로 확인 필요

## 목표
1. `createSmtpMailer({ smtpUrl, fromEmail, appBaseUrl? })` 실구현 추가.
2. `/api/auth/request` 가 production에서 SMTP mailer를 쓰도록 wiring (deps.ts 또는 route에서).
3. dev/test 경로는 console mailer 유지.
4. production에서 `SMTP_URL` 누락 시 fail-closed (deps.ts의 RuntimeConfigurationError 패턴).
5. 메일 본문은 plain text + HTML multipart, magic URL + 만료시각 포함. 비속어·분류자(개인화) 주입 금지.
6. 테스트: SMTP mailer unit 테스트 + magic-link 흐름 통합 테스트(모킹 기반).

## 작업 지시

### A. 의존성 선택 + 설치
- 우선순위: **순수 Node SMTP 직구현 > nodemailer**. nodemailer는 의존성이 크고, 운영 이슈도 많음.
- 그러나 실무 검증된 `nodemailer`가 더 안전하다고 판단되면 그쪽 채택해도 됨 — **선택 근거를 RESULT.md에 한 줄**.
- `package.json`에 추가 시 `--save` 로, 타입은 `--save-dev` (`@types/nodemailer`).
- dev-only 테스트 도구로는 nodemailer의 "stream" transport 또는 자체 in-memory mock 사용.

### B. SMTP Mailer 구현
- 위치: `src/lib/auth/email-smtp.ts` (신규).
- `createSmtpMailer({ smtpUrl, fromEmail, appBaseUrl? })` 익스포트.
- SMTP URL 파싱: `smtp://user:pass@host:port` / `smtps://...` 둘 다 지원. 파싱은 URL object로.
- 환경별 TLS: `smtps://` 또는 :465 → TLS, :587 → STARTTLS, :25 → plain. 기본 정책 1줄 RESULT.md에 기록.
- 메일 제목: `[Legal Compliance] 로그인 링크` (또는 상응 간결 제목).
- 본문:
  - plain: "아래 링크로 로그인하세요. 만료: {expiresAt}\n{magicUrl}\n링크를 타인에게 공유하지 마세요."
  - HTML: 동일 의미, 단일 `<a>` 만 포함, 외부 추적 픽셀 금지.
- 에러 처리: 발송 실패 시 `AuthError("email_delivery_failed")` 같은 구체 에러 throw (필요하면 `AuthErrorCode`에 추가 — `src/lib/auth/types.ts`).
- **토큰 로깅 금지**: 발송 과정 어디에도 magicUrl 원문 로깅 금지. 실패 시에도 redacted만.

### C. Deps 와이어
- `src/lib/assistant/deps.ts`에 `mailer?: MagicLinkMailer` 필드 추가.
- `createDefaultDeps`: `mailer: createConsoleMailer()` (dev/test 유지).
- `createProductionDeps`:
  - `SMTP_URL` 누락 시 기존 `RuntimeConfigurationError` 패턴으로 throw.
  - `mailer: createSmtpMailer({ smtpUrl: env.SMTP_URL, fromEmail: env.AUTH_FROM_EMAIL, appBaseUrl: env.APP_BASE_URL })`.
- `src/lib/env.ts`에서 SMTP_URL 규칙: **production에서만 required** 하게 처리할지, optional 유지하고 deps에서 체크할지 택 1. 현재 패턴(optional + deps fail-closed)과 일관되면 후자 권장.

### D. Route 와이어
- `/api/auth/request` (`src/app/api/auth/request/route.ts`)가 `requestMagicLink`에 `mailer` 파라미터를 deps에서 가져와 전달하도록 확인·수정.
- 기존에 deps를 참조 안 하면 `getAssistantDeps()`에서 mailer 가져오는 경로 추가.

### E. 테스트
- `tests/unit/auth/email-smtp.test.ts` — SMTP URL 파싱, subject/본문 shape, TLS 정책 분기, 실패 시 AuthError throw. 실제 SMTP는 모킹.
- `tests/integration/auth-request-route.test.ts` (또는 기존 통합 파일 확장): mock SMTP가 `send`를 정확히 1회 호출하고 인자가 올바른지 검증.
- 기존 magic-link 테스트(127개 등) 회귀 금지. 현재 159 passed / 1 skipped 동등 이상 유지.

### F. 검증
- `npm run typecheck` 0
- `npm run lint` 0
- `npm test` 통과 수 ≥ 159
- `npm run build` 성공
- SMTP_URL 없는 dev 경로 정상 부팅 (console mailer)

## 금지
- `plan.md`, `plans/phase-*.md`, `INVARIANTS.md` 편집 금지.
- 마이그레이션 추가 금지 (스코프 밖).
- UI 변경 금지.
- 외부 전송 서비스(SaaS) 의존 추가 금지 — SMTP만.
- 새 라우트 추가 금지. 기존 라우트에서만 배선.

## 완료 규약
1. `RESULT.md` 섹션 append (20줄 이내):
   ```
   ## SMTP 실연동
   - 상태: 성공|부분성공
   - 선택한 구현: (순수 SMTP | nodemailer) — 근거 한 줄
   - TLS 정책: 465/STARTTLS-587/plain-25 처리 요약 한 줄
   - 신규 파일: <목록>
   - 와이어링: deps.ts / /api/auth/request / env 변경 요약
   - 검증: typecheck/lint/test/build 결과 + 테스트 개수
   - 주의: magicUrl 로깅 금지 확인 한 줄
   ```
2. 완료 시 왼쪽 페인(`%2`)에 `SMTP_WIRING_DONE` 송신.
3. 장문/전체 diff 출력 금지 — RESULT.md에 압축.
