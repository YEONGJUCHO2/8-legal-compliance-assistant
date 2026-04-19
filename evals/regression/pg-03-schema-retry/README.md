# pg-03-schema-retry

- 설명: Anthropic adapter의 2-step schema retry와 persisted retry count를 고정한다.
- Phase 10 스펙: "two invalid outputs return `schema_error` with zero free-text fallback".
- 테스트 파일: `tests/integration/regression/pg-03-schema-retry.test.ts`
- 현재 커버리지: invalid→valid, invalid→invalid, 허용 kind union, history row `schema_retry_count` 를 검증한다.
- 알려진 갭: engine transport fault나 provider별 retry policy 차이는 본 스위트 범위 밖이다.
