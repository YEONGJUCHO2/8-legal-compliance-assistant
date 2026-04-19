# verification-parallelism

- 설명: 10-citation verification의 budget과 병렬 처리 거동을 현재 엔진 기준으로 고정한다.
- Phase 10 스펙: "10-citation answers stay under budget and slow-MCP paths downgrade correctly".
- 테스트 파일: `tests/integration/regression/verification-parallelism.test.ts`
- 현재 커버리지: fast-path verified, slow-path downgrade, 50ms x 10 병렬 처리 특성을 검증한다.
- 알려진 갭: MCP 네트워크 jitter나 production timeout variance는 deterministic stub 범위 밖이다.
