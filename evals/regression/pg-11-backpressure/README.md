# pg-11-backpressure

- 설명: 동일 사용자에 대한 limiter envelope와 concurrent-cap GAP을 추적한다.
- Phase 10 스펙: "2x-cap concurrent requests return 503 immediately without queue starvation".
- 테스트 파일: `tests/integration/regression/pg-11-backpressure.test.ts`
- 현재 커버리지: `rate_limited` envelope 필드(`kind`, `retryAfterSeconds`)를 고정한다.
- 알려진 갭: `createInMemoryRateLimitStore` 동시성 경쟁으로 exact N/N split 검증은 `test.todo` 로 남겨 둠.
