# pg-09-10-identity-fuzz

- 설명: identity binding 충돌과 세션 재사용 경계를 InMemoryAuthStore에서 고정한다.
- Phase 10 스펙: "cross-user session replay, provider migration collision, identity-link conflict".
- 테스트 파일: `tests/integration/regression/pg-09-10-identity-fuzz.test.ts`
- 현재 커버리지: magic_link→oidc 충돌, 동일 provider 내 subject collision, 세션 소유자 불일치를 검증한다.
- 알려진 갭: PG auth store 확장과 durable migration 시나리오는 범위 밖이다.
